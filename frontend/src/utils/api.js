/*
 * API module boundary:
 *   api/core.js         — axios instance, auth storage, caching, dedupe, interceptors
 *   api/endpoints/*.js  — domain-specific API functions only (no axios imports)
 *   api.js              — compatibility barrel; preserves all existing exports
 *
 * Endpoint modules must not create their own axios instances or duplicate
 * auth/dedupe/cache behavior. Add new domain modules under endpoints/ and
 * re-export them here.
 */
export {
  AUTH_INVALID_EVENT,
  getStoredAuth,
  setStoredAuth,
  clearAuthStorage,
  libraryLookupCache,
  coverResponseCache,
  coverInflightRequests,
  searchInflightRequests,
  setLibraryLookupCacheEntry,
  getCoverCacheEntry,
  fetchInflightOnce,
  fetchCoverWithMemo,
  getData,
  postData,
  putData,
  patchData,
  deleteData,
  lidarrCredentialParams,
  buildAuthenticatedApiUrl,
  default as api,
} from "./api/core.js";

export { default } from "./api/core.js";

export {
  checkHealth,
  getBootstrapStatus,
  browseFilesystem,
  ensureFilesystemPath,
  loginApi,
  logoutApi,
  getMe,
  completeOnboarding,
  testLidarrOnboarding,
  testNavidromeOnboarding,
  testLidarrLibraryAccessOnboarding,
  getLidarrProfilesOnboarding,
  getLidarrMetadataProfilesOnboarding,
  applyLidarrCommunityGuideOnboarding,
  testSlskdOnboarding,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  changeMyPassword,
  getMyListeningHistory,
  getMyLidarrPreferences,
  getMyDiscoverLayout,
  updateMyListeningHistory,
  updateMyLidarrPreferences,
  updateMyDiscoverLayout,
} from "./api/endpoints/auth.js";

export {
  searchUnified,
  searchCatalog,
} from "./api/endpoints/search.js";

export {
  getArtistDetails,
  getReleaseGroupDetails,
  getReleaseGroupTracks,
  getArtistCover,
  getReleaseGroupCoversBatch,
  getReleaseGroupCover,
  getSimilarArtistsForArtist,
  getArtistPreview,
  getArtistTopSongVideo,
  getArtistOverrides,
  updateArtistOverrides,
} from "./api/endpoints/artists.js";

export {
  getLibraryArtists,
  getLibraryArtist,
  lookupArtistInLibrary,
  readLibraryLookupCache,
  lookupArtistsInLibraryBatch,
  lookupAlbumsInLibraryBatch,
  addArtistToLibrary,
  deleteArtistFromLibrary,
  deleteAlbumFromLibrary,
  getLibraryAlbums,
  addLibraryAlbum,
  requestAlbumFromSearch,
  getLibraryTracks,
  updateLibraryAlbum,
  updateLibraryArtist,
  downloadAlbum,
  triggerAlbumSearch,
  getDownloadStatus,
  refreshLibraryArtist,
  getRequests,
  getRecentlyAdded,
  getRecentReleases,
} from "./api/endpoints/library.js";

export {
  getDiscovery,
  adoptDiscoverPlaylistAsFlow,
  adoptDiscoverPlaylistAsStatic,
  getDiscoverArtworkUrl,
  getNearbyShows,
  getDiscoveryFeedback,
  addDiscoveryFeedback,
  removeDiscoveryFeedback,
  resetDiscoveryFeedback,
  getTagSuggestions,
} from "./api/endpoints/discovery.js";

export {
  startPlexAuth,
  checkPlexAuth,
  getPlexResources,
  testPlexConnection,
  syncPlexNow,
  browsePaths,
  getAppSettings,
  updateAppSettings,
  getLidarrProfiles,
  getLidarrMetadataProfiles,
  getLidarrTags,
  testSlskdConnection,
  testProwlarrConnection,
  getProwlarrIndexers,
  testNzbgetConnection,
  testSabnzbdConnection,
  testLidarrConnection,
  testLidarrLibraryAccess,
  getStorageHealth,
  getSettingsTasks,
  clearSettingsStaleTasks,
  testGotifyConnection,
  applyLidarrCommunityGuide,
} from "./api/endpoints/settings.js";

export {
  getFlowTrackStreamUrl,
  getFlowArtworkUrl,
  uploadFlowArtwork,
  deleteFlowArtwork,
  generateFlowArtwork,
  getFlowStatus,
  getFlowJobs,
  createFlow,
  updateFlow,
  deleteFlow,
  convertFlowToStaticPlaylist,
  createSharedPlaylist,
  setFlowEnabled,
  importSharedPlaylist,
  updateSharedPlaylist,
  addSharedPlaylistTracks,
  deleteSharedPlaylist,
  deleteSharedPlaylistTrack,
  reSearchSharedPlaylistTrack,
  reSearchMissingSharedPlaylistTracks,
  startFlowPlaylist,
} from "./api/endpoints/playlists.js";