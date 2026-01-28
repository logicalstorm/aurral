import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Loader,
  Music,
  ExternalLink,
  CheckCircle,
  Plus,
  ArrowLeft,
  Calendar,
  MapPin,
  Tag,
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Radio,
  FileMusic,
  MoreVertical,
  Disc,
  Disc3,
} from "lucide-react";
import {
  getArtistDetails,
  getArtistCover,
  getReleaseGroupCover,
  lookupArtistInLibrary,
  getLibraryAlbums,
  getLibraryTracks,
  getReleaseGroupTracks,
  updateLibraryAlbum,
  getSimilarArtistsForArtist,
  getAppSettings,
  deleteArtistFromLibrary,
  deleteAlbumFromLibrary,
  updateLibraryArtist,
  getLibraryArtist,
  downloadAlbum,
  downloadTrack,
  refreshLibraryArtist,
  getDownloadStatus,
  addArtistToLibrary,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import ArtistImage from "../components/ArtistImage";

// Color palette for tags and genres
const TAG_COLORS = [
  "#845336",
  "#57553c",
  "#a17e3e",
  "#43454f",
  "#604848",
  "#5c6652",
  "#a18b62",
  "#8c4f4a",
  "#898471",
  "#c8b491",
  "#65788f",
  "#755e4a",
  "#718062",
  "#bc9d66",
];

// Get a deterministic color for a tag/genre based on its name
const getTagColor = (name) => {
  if (!name) return "#211f27";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
};

function ArtistDetailsPage() {
  const { mbid } = useParams();
  const navigate = useNavigate();
  const [artist, setArtist] = useState(null);
  const [coverImages, setCoverImages] = useState([]);
  const [libraryArtist, setLibraryArtist] = useState(null);
  const [libraryAlbums, setLibraryAlbums] = useState([]);

  // Helper function to deduplicate albums by ID and MBID
  const deduplicateAlbums = (albums) => {
    const seen = new Map();
    return albums.filter((album) => {
      // Use ID as primary key, MBID+artistId as secondary
      const key = album.id || `${album.mbid}-${album.artistId}`;
      if (seen.has(key)) {
        return false; // Duplicate
      }
      seen.set(key, true);
      return true;
    });
  };
  const [similarArtists, setSimilarArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [existsInLibrary, setExistsInLibrary] = useState(false);
  const [requestingAlbum, setRequestingAlbum] = useState(null);
  const [removingAlbum, setRemovingAlbum] = useState(null);
  const [albumDropdownOpen, setAlbumDropdownOpen] = useState(null);
  const [showDeleteAlbumModal, setShowDeleteAlbumModal] = useState(null);
  const [deleteAlbumFiles, setDeleteAlbumFiles] = useState(false);
  const [processingBulk, setProcessingBulk] = useState(false);
  const [expandedAlbum, setExpandedAlbum] = useState(null);
  const [albumTracks, setAlbumTracks] = useState({});
  const [loadingTracks, setLoadingTracks] = useState({});
  const [appSettings, setAppSettings] = useState(null);
  const [refreshingArtist, setRefreshingArtist] = useState(false);
  const similarArtistsScrollRef = useRef(null);
  const primaryReleaseTypes = ["Album", "EP", "Single"];
  const secondaryReleaseTypes = [
    "Live",
    "Remix",
    "Compilation",
    "Demo",
    "Broadcast",
    "Soundtrack",
    "Spokenword",
  ];
  const allReleaseTypes = [...primaryReleaseTypes, ...secondaryReleaseTypes];

  // Load filter settings from localStorage on mount
  const loadFilterSettings = () => {
    try {
      const saved = localStorage.getItem("artistDetailsFilterSettings");
      if (saved) {
        const parsed = JSON.parse(saved);
        // Validate that all saved types are valid release types
        const validTypes = parsed.filter((type) =>
          allReleaseTypes.includes(type),
        );
        // If we have valid types and they're not empty, use them; otherwise use all
        if (validTypes.length > 0) {
          return validTypes;
        }
      }
    } catch (e) {
      console.warn("Failed to load filter settings from localStorage:", e);
    }
    return allReleaseTypes;
  };

  const [selectedReleaseTypes, setSelectedReleaseTypes] =
    useState(loadFilterSettings);

  // Save filter settings to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(
        "artistDetailsFilterSettings",
        JSON.stringify(selectedReleaseTypes),
      );
    } catch (e) {
      console.warn("Failed to save filter settings to localStorage:", e);
    }
  }, [selectedReleaseTypes]);
  const [showMonitorDropdown, setShowMonitorDropdown] = useState(false);
  const [monitorOption, setMonitorOption] = useState("none");
  const [showRemoveDropdown, setShowRemoveDropdown] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deletingArtist, setDeletingArtist] = useState(false);
  const [showMonitorOptionMenu, setShowMonitorOptionMenu] = useState(false);
  const [updatingMonitor, setUpdatingMonitor] = useState(false);
  const [albumCovers, setAlbumCovers] = useState({});
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [loadingCover, setLoadingCover] = useState(true);
  const [loadingSimilar, setLoadingSimilar] = useState(true);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    setLoading(true);
    setError(null);
    setLoadingCover(true);
    setLoadingSimilar(true);

    // Fetch app settings (non-blocking)
    getAppSettings().then(setAppSettings).catch(() => {});

    // Build EventSource URL with authentication
    const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
    const password = localStorage.getItem("auth_password");
    const username = localStorage.getItem("auth_user") || "admin";
    
    let streamUrl = `${API_BASE_URL}/artists/${mbid}/stream`;
    if (password) {
      const token = btoa(`${username}:${password}`);
      streamUrl += `?token=${encodeURIComponent(token)}`;
    }

    // Use EventSource for streaming data
    const eventSource = new EventSource(streamUrl);
    let artistReceived = false;
    let streamComplete = false;
    let coverReceived = false;
    let similarReceived = false;
    
    // Fallback timeout - if cover/similar don't arrive within 10 seconds, fetch them directly
    const fallbackTimeout = setTimeout(() => {
      if (!coverReceived) {
        console.log('[Stream] Fallback: Fetching cover directly');
        getArtistCover(mbid)
          .then((coverData) => {
            if (coverData.images && coverData.images.length > 0) {
              setCoverImages(coverData.images);
            }
          })
          .catch(() => {})
          .finally(() => setLoadingCover(false));
      }
      if (!similarReceived) {
        console.log('[Stream] Fallback: Fetching similar artists directly');
        getSimilarArtistsForArtist(mbid)
          .then((similarData) => {
            setSimilarArtists(similarData.artists || []);
          })
          .catch(() => {})
          .finally(() => setLoadingSimilar(false));
      }
    }, 10000);

    eventSource.addEventListener('connected', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Stream] Connected for artist:', data.mbid);
      } catch (err) {
        console.error('[Stream] Error parsing connected event:', err);
      }
    });

    eventSource.addEventListener('artist', (event) => {
      try {
        const artistData = JSON.parse(event.data);
        console.log('[Stream] Received artist data');
        if (!artistData || !artistData.id) {
          throw new Error("Invalid artist data received");
        }
        setArtist(artistData);
        setLoading(false); // Show page immediately with basic data
        artistReceived = true;
      } catch (err) {
        console.error("Error parsing artist data:", err);
        setError("Failed to parse artist data");
        setLoading(false);
      }
    });

    eventSource.addEventListener('cover', (event) => {
      try {
        const coverData = JSON.parse(event.data);
        console.log('[Stream] Received cover data:', coverData.images?.length || 0, 'images');
        coverReceived = true;
        if (coverData.images && coverData.images.length > 0) {
          setCoverImages(coverData.images);
        }
        setLoadingCover(false);
      } catch (err) {
        console.error("Error parsing cover data:", err, event.data);
        setLoadingCover(false);
      }
    });

    eventSource.addEventListener('similar', (event) => {
      try {
        const similarData = JSON.parse(event.data);
        console.log('[Stream] Received similar artists:', similarData.artists?.length || 0, 'artists');
        similarReceived = true;
        setSimilarArtists(similarData.artists || []);
        setLoadingSimilar(false);
      } catch (err) {
        console.error("Error parsing similar artists data:", err, event.data);
        setLoadingSimilar(false);
      }
    });

    eventSource.addEventListener('releaseGroupCover', (event) => {
      try {
        const coverData = JSON.parse(event.data);
        if (coverData.images && coverData.images.length > 0 && coverData.mbid) {
          const front = coverData.images.find((img) => img.front) || coverData.images[0];
          if (front && front.image) {
            setAlbumCovers((prev) => ({
              ...prev,
              [coverData.mbid]: front.image,
            }));
          }
        }
      } catch (err) {
        console.error("Error parsing release group cover data:", err, event.data);
      }
    });

    eventSource.addEventListener('complete', () => {
      console.log('[Stream] Stream complete');
      streamComplete = true;
      clearTimeout(fallbackTimeout);
      eventSource.close();
      
      // Load library data after stream completes
      setLoadingLibrary(true);
      lookupArtistInLibrary(mbid)
        .then((lookup) => {
          setExistsInLibrary(lookup.exists);
          if (lookup.exists && lookup.artist) {
            return Promise.all([
              getLibraryArtist(
                lookup.artist.mbid || lookup.artist.foreignArtistId,
              ).catch((err) => {
                console.error("Failed to fetch full artist details:", err);
                return lookup.artist;
              }),
            ]).then(([fullArtist]) => {
              setLibraryArtist(fullArtist);
              return fullArtist.id || lookup.artist.id;
            });
          }
          return null;
        })
        .then((artistId) => {
          if (artistId) {
            // Fetch albums
            setTimeout(() => {
              getLibraryAlbums(artistId)
                .then((albums) => {
                  setLibraryAlbums(albums);
                })
                .catch((err) => {
                  setTimeout(() => {
                    getLibraryAlbums(artistId)
                      .then((albums) => setLibraryAlbums(albums))
                      .catch((e) => {});
                  }, 2000);
                });
            }, 1000);
          }
        })
        .catch((err) => {
          console.error("Failed to lookup artist in library:", err);
        })
        .finally(() => setLoadingLibrary(false));
    });

    eventSource.addEventListener('error', (event) => {
      try {
        const errorData = JSON.parse(event.data);
        setError(
          errorData.message ||
            errorData.error ||
            "Failed to fetch artist details"
        );
        setLoading(false);
        eventSource.close();
      } catch (err) {
        // If eventSource is in error state, fallback to regular API
        if (eventSource.readyState === EventSource.CLOSED) {
          console.warn("[Stream] Connection closed, falling back to regular API");
          eventSource.close();
          
          // Fallback to regular API call
          getArtistDetails(mbid)
            .then((artistData) => {
              if (!artistData || !artistData.id) {
                throw new Error("Invalid artist data received");
              }
              setArtist(artistData);
              setLoading(false);
              
              // Load other data in background
              getArtistCover(mbid)
                .then((coverData) => {
                  if (coverData.images && coverData.images.length > 0) {
                    setCoverImages(coverData.images);
                  }
                })
                .catch(() => {})
                .finally(() => setLoadingCover(false));
              
              getSimilarArtistsForArtist(mbid)
                .then((similarData) => {
                  setSimilarArtists(similarData.artists || []);
                })
                .catch(() => {})
                .finally(() => setLoadingSimilar(false));
            })
            .catch((err) => {
              console.error("Error fetching artist data:", err);
              setError(
                err.response?.data?.message ||
                  err.response?.data?.error ||
                  err.message ||
                  "Failed to fetch artist details"
              );
              setLoading(false);
            });
        }
      }
    });

    eventSource.onerror = (err) => {
      console.error("[Stream] EventSource onerror:", err, "readyState:", eventSource.readyState);
      // Only handle if we haven't received artist data yet
      if (!artistReceived && !streamComplete) {
        console.error("[Stream] EventSource error before artist data received");
        eventSource.close();
        
        // Fallback to regular API
        getArtistDetails(mbid)
          .then((artistData) => {
            if (!artistData || !artistData.id) {
              throw new Error("Invalid artist data received");
            }
            setArtist(artistData);
            setLoading(false);
            
            getArtistCover(mbid)
              .then((coverData) => {
                if (coverData.images && coverData.images.length > 0) {
                  setCoverImages(coverData.images);
                }
              })
              .catch(() => {})
              .finally(() => setLoadingCover(false));
            
            getSimilarArtistsForArtist(mbid)
              .then((similarData) => {
                setSimilarArtists(similarData.artists || []);
              })
              .catch(() => {})
              .finally(() => setLoadingSimilar(false));
          })
          .catch((err) => {
            console.error("Error fetching artist data:", err);
            setError(
              err.response?.data?.message ||
                err.response?.data?.error ||
                err.message ||
                "Failed to fetch artist details"
            );
            setLoading(false);
          });
      }
    };

    // Cleanup on unmount or mbid change
    return () => {
      clearTimeout(fallbackTimeout);
      eventSource.close();
    };
  }, [mbid]);

  const handleRefreshArtist = async () => {
    if (!libraryArtist?.mbid && !libraryArtist?.foreignArtistId) return;

    setRefreshingArtist(true);
    try {
      const mbid = libraryArtist.mbid || libraryArtist.foreignArtistId;
      await refreshLibraryArtist(mbid);

      // Refetch the artist data
      setTimeout(async () => {
        try {
          const refreshedArtist = await getLibraryArtist(mbid);
          setLibraryArtist(refreshedArtist);
          const albums = await getLibraryAlbums(refreshedArtist.id);
          setLibraryAlbums(deduplicateAlbums(albums));
          showSuccess("Artist data refreshed successfully.");
        } catch (err) {
          console.error("Failed to refresh artist data:", err);
          showError("Failed to refresh artist data");
        } finally {
          setRefreshingArtist(false);
        }
      }, 2000);
    } catch (err) {
      showError(`Failed to refresh artist: ${err.message}`);
      setRefreshingArtist(false);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteModal(true);
    setDeleteFiles(false);
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
    setDeleteFiles(false);
  };

  const handleDeleteConfirm = async () => {
    if (!libraryArtist?.id) return;

    setDeletingArtist(true);
    try {
      await deleteArtistFromLibrary(libraryArtist.mbid, deleteFiles);
      setExistsInLibrary(false);
      setLibraryArtist(null);
      setLibraryAlbums([]);
      showSuccess(
        `Successfully removed ${artist?.name || "artist"} from library${
          deleteFiles ? " and deleted files" : ""
        }`,
      );
      setShowDeleteModal(false);
      setDeleteFiles(false);
    } catch (err) {
      showError(
        `Failed to delete artist: ${err.response?.data?.message || err.message}`,
      );
    } finally {
      setDeletingArtist(false);
    }
  };

  const handleUpdateMonitorOption = async (newMonitorOption) => {
    if (!libraryArtist?.id) return;

    setUpdatingMonitor(true);
    try {
      // Update monitoring option
      const updatedArtist = {
        ...libraryArtist,
        monitored: newMonitorOption !== "none",
        monitorOption: newMonitorOption,
        addOptions: {
          ...(libraryArtist.addOptions || {}),
          monitor: newMonitorOption,
        },
      };

      // Remove any fields that shouldn't be sent in updates
      delete updatedArtist.statistics;
      delete updatedArtist.images;
      delete updatedArtist.links;

      const result = await updateLibraryArtist(
        libraryArtist.mbid,
        updatedArtist,
      );

      // Refetch the artist from library to get the actual updated data
      const refreshedArtist = await getLibraryArtist(libraryArtist.mbid);
      setLibraryArtist(refreshedArtist);

      setShowRemoveDropdown(false);

      const monitorLabels = {
        none: "None (Artist Only)",
        all: "All Albums",
        future: "Future Albums",
        missing: "Missing Albums",
        latest: "Latest Album",
        first: "First Album",
      };

      showSuccess(
        `Monitor option updated to: ${monitorLabels[newMonitorOption]}`,
      );
    } catch (err) {
      console.error("Update error:", err);
      showError(
        `Failed to update monitor option: ${err.response?.data?.message || err.message}`,
      );
    } finally {
      setUpdatingMonitor(false);
    }
  };

  const getCurrentMonitorOption = () => {
    if (!libraryArtist) return "none";

    // Check monitored status first
    if (libraryArtist.monitored === false) {
      return "none";
    }

    // Get the actual monitor option from the artist data
    // Check multiple possible locations for the monitor option
    const monitorOption =
      libraryArtist.monitorOption ||
      libraryArtist.addOptions?.monitor ||
      libraryArtist.monitorNewItems;

    // If we have a valid monitor option, return it
    if (
      monitorOption &&
      ["none", "all", "future", "missing", "latest", "first"].includes(
        monitorOption,
      )
    ) {
      return monitorOption;
    }

    // Default to "all" if monitored but no specific option set
    return libraryArtist.monitored ? "all" : "none";
  };

  const getMonitorOptionLabel = (option) => {
    const labels = {
      none: "None (Artist Only)",
      all: "All Albums",
      future: "Future Albums",
      missing: "Missing Albums",
      latest: "Latest Album",
      first: "First Album",
    };
    return labels[option] || "None (Artist Only)";
  };

  const handleAddToLibrary = async () => {
    if (!artist) {
      showError("Artist information not available");
      return;
    }

    try {
      // Add artist to library
      await addArtistToLibrary({
        foreignArtistId: artist.id,
        artistName: artist.name,
        quality: appSettings?.quality || "standard",
        rootFolderPath: appSettings?.rootFolderPath,
      });

      // Refresh library data
      const lookup = await lookupArtistInLibrary(artist.id);
      if (lookup.exists && lookup.artist) {
        const fullArtist = await getLibraryArtist(
          lookup.artist.mbid || lookup.artist.foreignArtistId,
        );
        setLibraryArtist(fullArtist);
        setExistsInLibrary(true);

        // Fetch albums for this artist
        await refreshLibraryArtist(
          fullArtist.mbid || fullArtist.foreignArtistId,
        );
        const albums = await getLibraryAlbums(fullArtist.id);
        setLibraryAlbums(deduplicateAlbums(albums));
      }

      showSuccess(`${artist.name} added to library successfully!`);
    } catch (err) {
      showError(
        `Failed to add artist to library: ${err.response?.data?.message || err.message}`,
      );
    }
  };

  const handleRequestAlbum = async (albumId, title) => {
    setRequestingAlbum(albumId);
    try {
      // If artist is not in library, add them first
      if (!existsInLibrary || !libraryArtist?.id) {
        if (!artist) {
          showError("Artist information not available");
          return;
        }

        // Add artist to library first (this just saves them, doesn't create folders)
        await addArtistToLibrary({
          foreignArtistId: artist.id,
          artistName: artist.name,
          quality: appSettings?.quality || "standard",
          rootFolderPath: appSettings?.rootFolderPath,
        });

        // Refresh library data
        const lookup = await lookupArtistInLibrary(artist.id);
        if (lookup.exists && lookup.artist) {
          const fullArtist = await getLibraryArtist(
            lookup.artist.mbid || lookup.artist.foreignArtistId,
          );
          setLibraryArtist(fullArtist);
          setExistsInLibrary(true);

          // Fetch albums for this artist
          await refreshLibraryArtist(
            fullArtist.mbid || fullArtist.foreignArtistId,
          );
          const albums = await getLibraryAlbums(fullArtist.id);
          setLibraryAlbums(deduplicateAlbums(albums));
        }
      }

      // Now get the library artist (should exist now)
      const currentLibraryArtist =
        libraryArtist ||
        (await lookupArtistInLibrary(artist.id).then((l) =>
          l.artist
            ? getLibraryArtist(l.artist.mbid || l.artist.foreignArtistId)
            : null,
        ));
      if (!currentLibraryArtist?.id) {
        throw new Error("Failed to get library artist");
      }

      // Find album by MBID, but ensure it belongs to the current artist
      let libraryAlbum = libraryAlbums.find(
        (a) =>
          (a.mbid === albumId || a.foreignAlbumId === albumId) &&
          a.artistId === currentLibraryArtist.id,
      );

      // If album doesn't exist, create it
      if (!libraryAlbum) {
        // Add album to library first
        const { addLibraryAlbum } = await import("../utils/api");
        try {
          libraryAlbum = await addLibraryAlbum(
            currentLibraryArtist.id,
            albumId,
            title,
          );
          
          // Always refresh albums list from server after adding to prevent duplicates
          // This ensures we have the latest state from the backend
          const refreshedAlbums = await getLibraryAlbums(currentLibraryArtist.id);
          const uniqueAlbums = deduplicateAlbums(refreshedAlbums);
          setLibraryAlbums(uniqueAlbums);
          
          // Find the album in the refreshed list
          libraryAlbum = uniqueAlbums.find(
            (a) =>
              (a.mbid === albumId || a.foreignAlbumId === albumId) &&
              a.artistId === currentLibraryArtist.id,
          );
        } catch (err) {
          // If that fails, try to refresh artist to get albums
          await refreshLibraryArtist(
            currentLibraryArtist.mbid || currentLibraryArtist.foreignArtistId,
          );
          const albums = await getLibraryAlbums(currentLibraryArtist.id);
          const uniqueAlbums = deduplicateAlbums(albums);
          setLibraryAlbums(uniqueAlbums);
          libraryAlbum = uniqueAlbums.find(
            (a) =>
              (a.mbid === albumId || a.foreignAlbumId === albumId) &&
              a.artistId === currentLibraryArtist.id,
          );

          if (!libraryAlbum) {
            throw new Error(
              "Album not found for this artist. Please try again.",
            );
          }
        }
      }

      // Monitor and download (this will create folders when files are downloaded)
      await updateLibraryAlbum(libraryAlbum.id, {
        ...libraryAlbum,
        monitored: true,
      });

      // Download album - pass artist info in case artist was just added
      await downloadAlbum(currentLibraryArtist.id, libraryAlbum.id, {
        artistMbid:
          currentLibraryArtist.mbid || currentLibraryArtist.foreignArtistId,
        artistName: currentLibraryArtist.artistName,
      });

      setLibraryAlbums((prev) =>
        prev.map((a) =>
          a.id === libraryAlbum.id ? { ...a, monitored: true } : a,
        ),
      );

      showSuccess(`Downloading album: ${title}`);
    } catch (err) {
      showError(`Failed to add album: ${err.message}`);
    } finally {
      setRequestingAlbum(null);
    }
  };

  const handleAlbumClick = async (releaseGroupId, libraryAlbumId) => {
    if (expandedAlbum === releaseGroupId) {
      setExpandedAlbum(null);
      return;
    }

    setExpandedAlbum(releaseGroupId);

    // Fetch tracks - from library if available, otherwise from MusicBrainz
    const trackKey = libraryAlbumId || releaseGroupId;
    if (!albumTracks[trackKey]) {
      setLoadingTracks((prev) => ({ ...prev, [trackKey]: true }));
      try {
        if (libraryAlbumId) {
          // Album is in library - fetch from library
          const tracks = await getLibraryTracks(libraryAlbumId);
          setAlbumTracks((prev) => ({ ...prev, [trackKey]: tracks }));
        } else {
          // Album not in library - fetch from MusicBrainz
          const tracks = await getReleaseGroupTracks(releaseGroupId);
          setAlbumTracks((prev) => ({ ...prev, [trackKey]: tracks }));
        }
      } catch (err) {
        console.error("Failed to fetch tracks:", err);
        showError("Failed to fetch track list");
      } finally {
        setLoadingTracks((prev) => ({ ...prev, [trackKey]: false }));
      }
    }
  };

  const handleDeleteAlbumClick = (albumId, title) => {
    setShowDeleteAlbumModal({ id: albumId, title });
    setDeleteAlbumFiles(false);
    setAlbumDropdownOpen(null);
  };

  const handleDeleteAlbumCancel = () => {
    setShowDeleteAlbumModal(null);
    setDeleteAlbumFiles(false);
  };

  const handleDeleteAlbumConfirm = async () => {
    if (!showDeleteAlbumModal) return;

    const { id: albumId, title } = showDeleteAlbumModal;

    try {
      const libraryAlbum = libraryAlbums.find(
        (a) => a.foreignAlbumId === albumId,
      );

      if (!libraryAlbum) {
        throw new Error("Album not found in library");
      }

      setRemovingAlbum(albumId);
      await deleteAlbumFromLibrary(libraryAlbum.id, deleteAlbumFiles);

      setLibraryAlbums((prev) => prev.filter((a) => a.id !== libraryAlbum.id));

      showSuccess(
        `Successfully deleted ${title}${deleteAlbumFiles ? " and files" : ""}`,
      );
      setShowDeleteAlbumModal(null);
      setDeleteAlbumFiles(false);
    } catch (err) {
      showError(
        `Failed to delete album: ${err.response?.data?.message || err.message}`,
      );
    } finally {
      setRemovingAlbum(null);
    }
  };

  // Check if a release group matches the selected release type filters
  const matchesReleaseTypeFilter = (releaseGroup) => {
    // If no filters selected, show all
    if (!selectedReleaseTypes || selectedReleaseTypes.length === 0) return true;

    const primaryType = releaseGroup["primary-type"];
    const secondaryTypes = releaseGroup["secondary-types"] || [];

    // Primary type must be in selected types
    if (!selectedReleaseTypes.includes(primaryType)) {
      return false;
    }

    // If there are secondary types, ALL of them must be in selected types
    // This means if you only select "Album", you won't see "Album, Live" or "Album, Remix"
    // You need to also select "Live" or "Remix" to see those combinations
    if (secondaryTypes.length > 0) {
      return secondaryTypes.every((secondaryType) =>
        selectedReleaseTypes.includes(secondaryType),
      );
    }

    // Primary type matches and no secondary types - show it
    return true;
  };

  // Check if any filters are active
  const hasActiveFilters = () => {
    // If selected types don't match all types, filters are active
    if (selectedReleaseTypes.length !== allReleaseTypes.length) {
      return true;
    }
    // Check if all types are included (order doesn't matter)
    return !allReleaseTypes.every((type) =>
      selectedReleaseTypes.includes(type),
    );
  };

  const handleMonitorAll = async () => {
    if (!libraryAlbums.length) return;

    const visibleReleaseGroups = artist["release-groups"].filter(
      matchesReleaseTypeFilter,
    );

    const visibleMbids = new Set(visibleReleaseGroups.map((rg) => rg.id));

    const unmonitored = libraryAlbums.filter(
      (a) => !a.monitored && visibleMbids.has(a.mbid),
    );

    if (unmonitored.length === 0) {
      showSuccess("No new unmonitored albums in current view!");
      return;
    }

    setProcessingBulk(true);
    try {
      const ids = unmonitored.map((a) => a.id);
      // Monitor albums and trigger downloads
      for (const id of ids) {
        const album = libraryAlbums.find((a) => a.id === id);
        if (album) {
          await updateLibraryAlbum(id, { ...album, monitored: true });
          await downloadAlbum(libraryArtist.id, id);
        }
      }

      setLibraryAlbums((prev) =>
        prev.map((a) => (ids.includes(a.id) ? { ...a, monitored: true } : a)),
      );

      showSuccess(`Added ${ids.length} albums to monitor`);
    } catch (err) {
      console.error(err);
      showError("Failed to add albums");
    } finally {
      setProcessingBulk(false);
    }
  };

  const [downloadStatuses, setDownloadStatuses] = useState({});

  useEffect(() => {
    // Poll download status every 5 seconds if we have albums
    if (!libraryAlbums.length) return;

    const pollDownloadStatus = async () => {
      try {
        const albumIds = libraryAlbums.map((a) => a.id).filter(Boolean);
        if (albumIds.length > 0) {
          const statuses = await getDownloadStatus(albumIds);
          setDownloadStatuses(statuses);
        }
      } catch (error) {
        console.error("Failed to fetch download status:", error);
      }
    };

    // Poll immediately, then every 5 seconds
    pollDownloadStatus();
    const interval = setInterval(pollDownloadStatus, 5000);

    return () => clearInterval(interval);
  }, [libraryAlbums]);

  const getAlbumStatus = (releaseGroupId) => {
    // If artist is not in library, album is not in library
    if (!existsInLibrary || !libraryArtist || libraryAlbums.length === 0) {
      return null;
    }

    const album = libraryAlbums.find(
      (a) => a.mbid === releaseGroupId || a.foreignAlbumId === releaseGroupId,
    );

    if (!album) {
      return null;
    }

    // Check download status first
    const downloadStatus = downloadStatuses[album.id];
    if (downloadStatus) {
      const statusLabels = {
        adding: "Adding...",
        searching: "Searching...",
        downloading: "Downloading...",
        moving: "Moving files...",
        added: "Added",
      };

      return {
        status: downloadStatus.status,
        label: statusLabels[downloadStatus.status] || downloadStatus.status,
        libraryId: album.id,
        albumInfo: album,
        downloadStatus: downloadStatus,
      };
    }

    const isComplete = album.statistics?.percentOfTracks === 100;
    const isAvailable = isComplete; // Available if 100% downloaded, regardless of monitored status
    const isProcessing = album.monitored && !isComplete;

    return {
      status: isAvailable
        ? "available"
        : isProcessing
          ? "processing"
          : "unmonitored",
      label: isAvailable
        ? "Available"
        : isProcessing
          ? "Processing"
          : "Not Monitored",
      libraryId: album.id,
      albumInfo: album,
    };
  };

  const formatLifeSpan = (lifeSpan) => {
    if (!lifeSpan) return null;
    const { begin, end, ended } = lifeSpan;
    if (!begin) return null;

    const beginYear = begin.split("-")[0];
    if (ended && end) {
      const endYear = end.split("-")[0];
      return `${beginYear} - ${endYear}`;
    }
    return `${beginYear} - Present`;
  };

  const getArtistType = (type) => {
    const types = {
      Person: "Solo Artist",
      Group: "Band",
      Orchestra: "Orchestra",
      Choir: "Choir",
      Character: "Character",
      Other: "Other",
    };
    return types[type] || type;
  };

  const getCoverImage = () => {
    if (coverImages.length > 0) {
      const frontCover = coverImages.find((img) => img.front);
      return frontCover?.image || coverImages[0]?.image;
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader
          className="w-12 h-12 animate-spin"
          style={{ color: "#c1c1c3" }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="text-center py-12">
          <Music
            className="w-16 h-16 mx-auto mb-4"
            style={{ color: "#c1c1c3" }}
          />
          <h3 className="text-xl font-semibold mb-2" style={{ color: "#fff" }}>
            Error Loading Artist
          </h3>
          <p className="mb-6" style={{ color: "#c1c1c3" }}>
            {error}
          </p>
          <button
            onClick={() => navigate("/search")}
            className="btn btn-primary"
          >
            Back to Search
          </button>
        </div>
      </div>
    );
  }

  if (!artist) {
    return null;
  }

  const coverImage = getCoverImage();
  const lifeSpan = formatLifeSpan(artist["life-span"]);

  return (
    <div className="animate-fade-in">
      <button
        onClick={() => navigate(-1)}
        className="btn btn-secondary mb-6 inline-flex items-center"
      >
        <ArrowLeft className="w-5 h-5 mr-2" />
        Back
      </button>

      <div className="card mb-8 relative">
        {existsInLibrary && (
          <button
            onClick={handleRefreshArtist}
            disabled={refreshingArtist}
            className="absolute top-4 right-4 btn btn-secondary btn-sm p-2"
            title="Refresh & Scan Artist"
          >
            {refreshingArtist ? (
              <Loader className="w-5 h-5 animate-spin" />
            ) : (
              <RefreshCw className="w-5 h-5" />
            )}
          </button>
        )}
        <div className="flex flex-col md:flex-row gap-6">
          <div
            className="w-full md:w-64 h-64 flex-shrink-0 overflow-hidden relative"
            style={{ backgroundColor: "#211f27" }}
          >
            {loadingCover ? (
              <div className="w-full h-full flex items-center justify-center">
                <Loader
                  className="w-12 h-12 animate-spin"
                  style={{ color: "#c1c1c3" }}
                />
              </div>
            ) : coverImage ? (
              <img
                src={coverImage}
                alt={artist.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Music className="w-24 h-24" style={{ color: "#c1c1c3" }} />
              </div>
            )}
          </div>

          <div className="flex-1">
            <h1 className="text-4xl font-bold mb-2" style={{ color: "#fff" }}>
              {artist.name}
            </h1>

            {artist["sort-name"] && artist["sort-name"] !== artist.name && (
              <p className="text-lg mb-4" style={{ color: "#c1c1c3" }}>
                {artist["sort-name"]}
              </p>
            )}

            {artist.disambiguation && (
              <p className="italic mb-4" style={{ color: "#c1c1c3" }}>
                {artist.disambiguation}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {artist.type && (
                <div className="flex items-center" style={{ color: "#fff" }}>
                  <Music
                    className="w-5 h-5 mr-2"
                    style={{ color: "#c1c1c3" }}
                  />
                  <span className="font-medium mr-2">Type:</span>
                  <span>{getArtistType(artist.type)}</span>
                </div>
              )}

              {lifeSpan && (
                <div className="flex items-center" style={{ color: "#fff" }}>
                  <Calendar
                    className="w-5 h-5 mr-2"
                    style={{ color: "#c1c1c3" }}
                  />
                  <span className="font-medium mr-2">Active:</span>
                  <span>{lifeSpan}</span>
                </div>
              )}

              {artist.country && (
                <div className="flex items-center" style={{ color: "#fff" }}>
                  <MapPin
                    className="w-5 h-5 mr-2"
                    style={{ color: "#c1c1c3" }}
                  />
                  <span className="font-medium mr-2">Country:</span>
                  <span>{artist.country}</span>
                </div>
              )}

              {artist.area && artist.area.name && (
                <div className="flex items-center" style={{ color: "#fff" }}>
                  <MapPin
                    className="w-5 h-5 mr-2"
                    style={{ color: "#c1c1c3" }}
                  />
                  <span className="font-medium mr-2">Area:</span>
                  <span>{artist.area.name}</span>
                </div>
              )}

              {loadingLibrary && existsInLibrary ? (
                <div className="flex items-center " style={{ color: "#fff" }}>
                  <Radio
                    className="w-5 h-5 mr-2 "
                    style={{ color: "#c1c1c3" }}
                  />
                  <span className="font-medium mr-2">Monitoring:</span>
                  <Loader
                    className="w-4 h-4 animate-spin"
                    style={{ color: "#c1c1c3" }}
                  />
                </div>
              ) : (
                existsInLibrary && (
                  <div className="flex items-center " style={{ color: "#fff" }}>
                    <Radio
                      className="w-5 h-5 mr-2 "
                      style={{ color: "#c1c1c3" }}
                    />
                    <span className="font-medium mr-2">Monitoring:</span>
                    <span>
                      {getMonitorOptionLabel(getCurrentMonitorOption())}
                    </span>
                  </div>
                )
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              {loadingLibrary ? (
                <div
                  className="btn btn-secondary inline-flex items-center"
                  disabled
                >
                  <Loader className="w-5 h-5 mr-2 animate-spin" />
                  Loading...
                </div>
              ) : existsInLibrary ? (
                <>
                  <div className="relative inline-flex">
                    <button className="btn btn-success inline-flex items-center">
                      <CheckCircle className="w-5 h-5 mr-2" />
                      In Your Library
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setShowRemoveDropdown(!showRemoveDropdown)
                        }
                        className="btn btn-success inline-flex items-center -ml-1 px-2"
                        title="Options"
                      >
                        <ChevronDown
                          className={`w-4 h-7 transition-transform ${showRemoveDropdown ? "rotate-180" : ""}`}
                        />
                      </button>
                      {showRemoveDropdown && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setShowRemoveDropdown(false)}
                          />
                          <div
                            className="absolute right-0 mt-2 w-56 z-20 py-1"
                            style={{ backgroundColor: "#211f27" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowMonitorOptionMenu(
                                  !showMonitorOptionMenu,
                                );
                              }}
                              disabled={updatingMonitor}
                              className="w-full text-left px-4 py-2 text-sm  hover:bg-gray-900/50 transition-colors flex items-center justify-between"
                              style={{ color: "#fff" }}
                            >
                              <span>Change Monitor Option</span>
                              <ChevronDown
                                className={`w-4 h-4 transition-transform ${showMonitorOptionMenu ? "rotate-180" : ""}`}
                              />
                            </button>

                            {showMonitorOptionMenu && (
                              <>
                                <div className="my-1" />
                                {[
                                  {
                                    value: "none",
                                    label: "None (Artist Only)",
                                  },
                                  { value: "all", label: "All Albums" },
                                  { value: "future", label: "Future Albums" },
                                  { value: "missing", label: "Missing Albums" },
                                  { value: "latest", label: "Latest Album" },
                                  { value: "first", label: "First Album" },
                                ].map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUpdateMonitorOption(option.value);
                                      setShowMonitorOptionMenu(false);
                                      setShowRemoveDropdown(false);
                                    }}
                                    disabled={updatingMonitor}
                                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-900/50 transition-colors"
                                    style={
                                      getCurrentMonitorOption() === option.value
                                        ? {
                                            backgroundColor: "#211f27",
                                            color: "#fff",
                                            fontWeight: "500",
                                          }
                                        : { color: "#fff" }
                                    }
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </>
                            )}

                            <div className=" my-1" />
                            <button
                              type="button"
                              onClick={() => {
                                handleDeleteClick();
                                setShowRemoveDropdown(false);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors flex items-center"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Remove from Library
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <button
                  onClick={handleAddToLibrary}
                  className="btn btn-secondary inline-flex items-center"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  Add to Library
                </button>
              )}

              <a
                href={`https://www.last.fm/music/${encodeURIComponent(artist.name)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary inline-flex items-center"
              >
                <ExternalLink className="w-5 h-5 mr-2" />
                View on Last.fm
              </a>
              {artist.id && (
                <a
                  href={`https://musicbrainz.org/artist/${artist.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary inline-flex items-center"
                >
                  <ExternalLink className="w-5 h-5 mr-2" />
                  View on MusicBrainz
                </a>
              )}
            </div>
          </div>
        </div>

        {((artist.tags && artist.tags.length > 0) ||
          (artist.genres && artist.genres.length > 0)) && (
          <div className="mt-3 pt-3">
            <div className="flex flex-wrap gap-2">
              {artist.genres &&
                artist.genres.map((genre, idx) => (
                  <button
                    key={`genre-${idx}`}
                    onClick={() =>
                      navigate(
                        `/search?q=${encodeURIComponent(genre.name)}&type=tag`,
                      )
                    }
                    className="badge text-sm px-3 py-1 hover:opacity-80 cursor-pointer transition-opacity transition-[border-radius] ease hover:!rounded-[50px]"
                    style={{
                      backgroundColor: getTagColor(genre.name),
                      color: "#fff",
                    }}
                    title={`View artists with genre: ${genre.name}`}
                  >
                    {genre.name}
                  </button>
                ))}
              {artist.tags &&
                artist.tags.map((tag, idx) => (
                  <button
                    key={`tag-${idx}`}
                    onClick={() =>
                      navigate(
                        `/search?q=${encodeURIComponent(tag.name)}&type=tag`,
                      )
                    }
                    className="badge text-sm px-3 py-1 hover:opacity-80 cursor-pointer transition-opacity transition-[border-radius] ease hover:!rounded-[50px]"
                    style={{
                      backgroundColor: getTagColor(tag.name),
                      color: "#fff",
                    }}
                    title={`View artists with tag: ${tag.name}`}
                  >
                    {tag.name}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Albums in Library Section */}
      {existsInLibrary &&
        libraryAlbums &&
        libraryAlbums.length > 0 &&
        (() => {
          // Filter to only show albums that have been downloaded (have files)
          const downloadedAlbums = libraryAlbums.filter((album) => {
            // Show if album has any tracks with files (percentOfTracks > 0) or has size on disk
            return (
              album.statistics?.percentOfTracks > 0 ||
              album.statistics?.sizeOnDisk > 0 ||
              downloadStatuses[album.id] // Also show if currently downloading
            );
          });

          if (downloadedAlbums.length === 0) return null;

          return (
            <div className="card mb-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <h2
                  className="text-2xl font-bold  flex items-center"
                  style={{ color: "#fff" }}
                >
                  <FileMusic
                    className="w-6 h-6 mr-2"
                    style={{ color: "#c1c1c3" }}
                  />
                  Albums in Your Library ({downloadedAlbums.length})
                </h2>
              </div>
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {downloadedAlbums
                  .sort((a, b) => {
                    const dateA = a.releaseDate || "";
                    const dateB = b.releaseDate || "";
                    return dateB.localeCompare(dateA);
                  })
                  .map((libraryAlbum) => {
                    const isExpanded =
                      expandedAlbum === libraryAlbum.mbid ||
                      expandedAlbum === libraryAlbum.foreignAlbumId;
                    const trackKey = libraryAlbum.id;
                    const tracks = albumTracks[trackKey] || null;
                    const isLoadingTracks = loadingTracks[trackKey] || false;
                    const downloadStatus = downloadStatuses[libraryAlbum.id];
                    const isComplete =
                      libraryAlbum.statistics?.percentOfTracks === 100;

                    return (
                      <div
                        key={libraryAlbum.id}
                        className="hover:bg-gray-900/50 transition-colors"
                        style={{ backgroundColor: "#211f27" }}
                      >
                        <div
                          className={`flex items-center justify-between p-4 cursor-pointer`}
                          onClick={() =>
                            handleAlbumClick(
                              libraryAlbum.mbid || libraryAlbum.foreignAlbumId,
                              libraryAlbum.id,
                            )
                          }
                        >
                          <div className="flex-1 flex items-center gap-3">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAlbumClick(
                                  libraryAlbum.mbid ||
                                    libraryAlbum.foreignAlbumId,
                                  libraryAlbum.id,
                                );
                              }}
                              className=" hover:text-gray-300 transition-colors"
                              style={{ color: "#c1c1c3" }}
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>
                            {albumCovers[
                              libraryAlbum.mbid || libraryAlbum.foreignAlbumId
                            ] ? (
                              <img
                                src={
                                  albumCovers[
                                    libraryAlbum.mbid ||
                                      libraryAlbum.foreignAlbumId
                                  ]
                                }
                                alt={libraryAlbum.albumName}
                                className="w-12 h-12 flex-shrink-0 object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div
                                className="w-12 h-12 flex-shrink-0  flex items-center justify-center"
                                style={{ backgroundColor: "#211f27" }}
                              >
                                <Music
                                  className="w-6 h-6 "
                                  style={{ color: "#c1c1c3" }}
                                />
                              </div>
                            )}
                            <div className="flex-1">
                              <h3
                                className="font-semibold "
                                style={{ color: "#fff" }}
                              >
                                {libraryAlbum.albumName}
                              </h3>
                              <div
                                className="flex items-center gap-3 mt-1 text-sm "
                                style={{ color: "#c1c1c3" }}
                              >
                                {libraryAlbum.releaseDate && (
                                  <span>
                                    {libraryAlbum.releaseDate.split("-")[0]}
                                  </span>
                                )}
                                {libraryAlbum.albumType && (
                                  <span className="badge badge-primary text-xs">
                                    {libraryAlbum.albumType}
                                  </span>
                                )}
                                {libraryAlbum.statistics && (
                                  <span className="text-xs">
                                    {libraryAlbum.statistics.trackCount || 0}{" "}
                                    tracks
                                    {libraryAlbum.statistics.percentOfTracks !==
                                      undefined && (
                                      <span className="ml-1">
                                        (
                                        {
                                          libraryAlbum.statistics
                                            .percentOfTracks
                                        }
                                        % complete)
                                      </span>
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {downloadStatus ? (
                              downloadStatus.status === "added" ||
                              downloadStatus.status === "available" ? (
                                <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase bg-green-500/20 text-green-400 cursor-default">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  Added
                                </span>
                              ) : (
                                <span
                                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase cursor-default"
                                  style={{
                                    backgroundColor: "#211f27",
                                    color: "#c1c1c3",
                                  }}
                                >
                                  <Loader className="w-3.5 h-3.5 animate-spin" />
                                  {downloadStatus.status === "adding"
                                    ? "Adding..."
                                    : downloadStatus.status === "searching"
                                      ? "Searching..."
                                      : downloadStatus.status === "downloading"
                                        ? "Downloading..."
                                        : downloadStatus.status === "moving"
                                          ? "Moving..."
                                          : downloadStatus.status}
                                </span>
                              )
                            ) : isComplete ? (
                              <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase bg-green-500/20 text-green-400 cursor-default">
                                <CheckCircle className="w-3.5 h-3.5" />
                                Complete
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase bg-yellow-500/20 text-yellow-400 cursor-default">
                                Incomplete
                              </span>
                            )}
                            <div className="relative overflow-visible">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAlbumDropdownOpen(
                                    albumDropdownOpen ===
                                      (libraryAlbum.mbid ||
                                        libraryAlbum.foreignAlbumId)
                                      ? null
                                      : libraryAlbum.mbid ||
                                          libraryAlbum.foreignAlbumId,
                                  );
                                }}
                                className="btn btn-secondary btn-sm p-2"
                                title="Options"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                              {albumDropdownOpen ===
                                (libraryAlbum.mbid ||
                                  libraryAlbum.foreignAlbumId) && (
                                <>
                                  <div
                                    className="fixed inset-0 z-10"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAlbumDropdownOpen(null);
                                    }}
                                  />
                                  <div
                                    className="absolute right-0 top-full mt-2 w-48  shadow-lg  z-20 py-1"
                                    style={{ backgroundColor: "#211f27" }}
                                  >
                                    <a
                                      href={`https://www.last.fm/music/${encodeURIComponent(artist.name)}/${encodeURIComponent(libraryAlbum.albumName)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="w-full text-left px-4 py-2 text-sm  hover:bg-gray-900/50 transition-colors flex items-center"
                                      style={{ color: "#fff" }}
                                      onClick={() => setAlbumDropdownOpen(null)}
                                    >
                                      <ExternalLink className="w-4 h-4 mr-2" />
                                      View on Last.fm
                                    </a>
                                    <div className="my-1" />
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteAlbumClick(
                                          libraryAlbum.mbid ||
                                            libraryAlbum.foreignAlbumId,
                                          libraryAlbum.albumName,
                                        );
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors flex items-center"
                                    >
                                      <Trash2 className="w-4 h-4 mr-2" />
                                      Delete Album
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {isExpanded && (
                          <div
                            className=" px-4 py-4 /50 overflow-hidden"
                            style={{ backgroundColor: "#211f27" }}
                          >
                            {/* Show library album info */}
                            <div className="mb-4 pb-4 ">
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                                {libraryAlbum.statistics && (
                                  <>
                                    <div>
                                      <span
                                        className=""
                                        style={{ color: "#c1c1c3" }}
                                      >
                                        Tracks:
                                      </span>
                                      <span
                                        className="ml-2 font-medium "
                                        style={{ color: "#fff" }}
                                      >
                                        {libraryAlbum.statistics.trackCount ||
                                          0}
                                      </span>
                                    </div>
                                    <div>
                                      <span
                                        className=""
                                        style={{ color: "#c1c1c3" }}
                                      >
                                        Size:
                                      </span>
                                      <span
                                        className="ml-2 font-medium "
                                        style={{ color: "#fff" }}
                                      >
                                        {libraryAlbum.statistics.sizeOnDisk
                                          ? `${(libraryAlbum.statistics.sizeOnDisk / 1024 / 1024).toFixed(2)} MB`
                                          : "N/A"}
                                      </span>
                                    </div>
                                    <div>
                                      <span
                                        className=""
                                        style={{ color: "#c1c1c3" }}
                                      >
                                        Completion:
                                      </span>
                                      <span
                                        className="ml-2 font-medium "
                                        style={{ color: "#fff" }}
                                      >
                                        {libraryAlbum.statistics
                                          .percentOfTracks || 0}
                                        %
                                      </span>
                                    </div>
                                  </>
                                )}
                                {libraryAlbum.releaseDate && (
                                  <div>
                                    <span
                                      className=""
                                      style={{ color: "#c1c1c3" }}
                                    >
                                      Release Date:
                                    </span>
                                    <span
                                      className="ml-2 font-medium "
                                      style={{ color: "#fff" }}
                                    >
                                      {libraryAlbum.releaseDate}
                                    </span>
                                  </div>
                                )}
                                {libraryAlbum.albumType && (
                                  <div>
                                    <span
                                      className=""
                                      style={{ color: "#c1c1c3" }}
                                    >
                                      Type:
                                    </span>
                                    <span
                                      className="ml-2 font-medium "
                                      style={{ color: "#fff" }}
                                    >
                                      {libraryAlbum.albumType}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Show tracks */}
                            <div>
                              {isLoadingTracks ? (
                                <div className="flex items-center justify-center py-8">
                                  <Loader
                                    className="w-6 h-6 animate-spin"
                                    style={{ color: "#c1c1c3" }}
                                  />
                                </div>
                              ) : tracks && tracks.length > 0 ? (
                                <div className="space-y-0">
                                  {tracks.map((track, idx) => (
                                    <div
                                      key={track.id || track.mbid || idx}
                                      className="flex items-center justify-between p-2 transition-colors"
                                      style={{
                                        backgroundColor:
                                          idx % 2 === 0
                                            ? "transparent"
                                            : "rgba(255, 255, 255, 0.02)",
                                      }}
                                    >
                                      <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <span
                                          className="text-xs  w-6 flex-shrink-0"
                                          style={{ color: "#c1c1c3" }}
                                        >
                                          {track.trackNumber ||
                                            track.position ||
                                            idx + 1}
                                        </span>
                                        <span
                                          className="text-sm  truncate"
                                          style={{ color: "#fff" }}
                                        >
                                          {track.title ||
                                            track.trackName ||
                                            "Unknown Track"}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        {track.length && (
                                          <span
                                            className="text-xs "
                                            style={{ color: "#c1c1c3" }}
                                          >
                                            {Math.floor(track.length / 60000)}:
                                            {Math.floor(
                                              (track.length % 60000) / 1000,
                                            )
                                              .toString()
                                              .padStart(2, "0")}
                                          </span>
                                        )}
                                        {track.hasFile ? (
                                          <CheckCircle className="w-4 h-4 text-green-500" />
                                        ) : libraryAlbum.id ? (
                                          <span
                                            className="text-xs "
                                            style={{ color: "#c1c1c3" }}
                                          >
                                            Missing
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p
                                  className="text-sm  italic py-4"
                                  style={{ color: "#c1c1c3" }}
                                >
                                  No tracks available
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })()}

      {artist["release-groups"] && artist["release-groups"].length > 0 && (
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <h2
              className="text-2xl font-bold flex items-center"
              style={{ color: "#fff" }}
            >
              Albums & Releases (
              {artist["release-groups"].filter(matchesReleaseTypeFilter).length}
              )
            </h2>
            <div className="flex items-center gap-3">
              {/* Primary Type Buttons */}
              <div className="flex items-center gap-2">
                {primaryReleaseTypes.map((type) => {
                  const isSelected = selectedReleaseTypes.includes(type);
                  const getIcon = () => {
                    if (type === "Album") return <Disc className="w-4 h-4" />;
                    if (type === "EP") return <Disc3 className="w-4 h-4" />;
                    if (type === "Single")
                      return <FileMusic className="w-4 h-4" />;
                    return <Music className="w-4 h-4" />;
                  };
                  return (
                    <button
                      key={type}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedReleaseTypes(
                            selectedReleaseTypes.filter((t) => t !== type),
                          );
                        } else {
                          setSelectedReleaseTypes([
                            ...selectedReleaseTypes,
                            type,
                          ]);
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-all"
                      style={{
                        backgroundColor: isSelected ? "#4a4a4a" : "#211f27",
                        color: "#fff",
                      }}
                      title={type}
                    >
                      {getIcon()}
                      <span>{type}</span>
                    </button>
                  );
                })}
              </div>

              {/* Filter Dropdown Button */}
              <div className="relative">
                <button
                  onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                  className="btn btn-outline-secondary btn-sm flex items-center gap-2 px-3 py-2"
                >
                  <Tag className="w-4 h-4" />
                  <span className="text-sm">Filter</span>
                  {hasActiveFilters() && (
                    <span
                      className="text-white text-xs px-1.5 py-0.5 min-w-[18px] h-[18px] flex items-center justify-center"
                      style={{ backgroundColor: "#211f27" }}
                    >
                      {secondaryReleaseTypes.length -
                        selectedReleaseTypes.filter((t) =>
                          secondaryReleaseTypes.includes(t),
                        ).length}
                    </span>
                  )}
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${showFilterDropdown ? "rotate-180" : ""}`}
                  />
                </button>

                {/* Filter Dropdown Panel */}
                {showFilterDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowFilterDropdown(false)}
                    />
                    <div
                      className="absolute right-0 top-full mt-2 z-20  shadow-xl  p-4 min-w-[280px]"
                      style={{ backgroundColor: "#211f27" }}
                    >
                      <div className="space-y-4">
                        {/* Secondary Types */}
                        <div>
                          <h3
                            className="text-sm font-semibold  mb-2"
                            style={{ color: "#fff" }}
                          >
                            Secondary Types
                          </h3>
                          <div className="space-y-2">
                            {secondaryReleaseTypes.map((type) => (
                              <label
                                key={type}
                                className="flex items-center space-x-2 cursor-pointer hover:bg-gray-900/50 px-2 py-1.5 transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedReleaseTypes.includes(type)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedReleaseTypes([
                                        ...selectedReleaseTypes,
                                        type,
                                      ]);
                                    } else {
                                      setSelectedReleaseTypes(
                                        selectedReleaseTypes.filter(
                                          (t) => t !== type,
                                        ),
                                      );
                                    }
                                  }}
                                  className="form-checkbox h-4 w-4"
                                  style={{ color: "#c1c1c3" }}
                                />
                                <span
                                  className="text-sm "
                                  style={{ color: "#fff" }}
                                >
                                  {type}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Quick Actions */}
                        <div className=" pt-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const currentPrimary =
                                  selectedReleaseTypes.filter((t) =>
                                    primaryReleaseTypes.includes(t),
                                  );
                                setSelectedReleaseTypes([
                                  ...currentPrimary,
                                  ...secondaryReleaseTypes,
                                ]);
                              }}
                              className="text-xs hover:underline"
                              style={{ color: "#c1c1c3" }}
                            >
                              Select All
                            </button>
                            <span className="" style={{ color: "#c1c1c3" }}>
                              |
                            </span>
                            <button
                              onClick={() => {
                                const currentPrimary =
                                  selectedReleaseTypes.filter((t) =>
                                    primaryReleaseTypes.includes(t),
                                  );
                                setSelectedReleaseTypes(currentPrimary);
                              }}
                              className="text-xs hover:underline"
                              style={{ color: "#c1c1c3" }}
                            >
                              Clear All
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Add All Button */}
              {existsInLibrary && (
                <button
                  onClick={handleMonitorAll}
                  disabled={processingBulk}
                  className="btn btn-outline-primary btn-sm flex items-center gap-2 px-4 py-2"
                >
                  {processingBulk ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Processing...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      <span className="text-sm">
                        {hasActiveFilters() ? "Add All Filtered" : "Add All"}
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {artist["release-groups"]
              .filter(matchesReleaseTypeFilter)
              .sort((a, b) => {
                const dateA = a["first-release-date"] || "";
                const dateB = b["first-release-date"] || "";
                return dateB.localeCompare(dateA);
              })
              .map((releaseGroup) => {
                const status = getAlbumStatus(releaseGroup.id);
                const isExpanded = expandedAlbum === releaseGroup.id;
                const libraryAlbumId = status?.libraryId;
                const trackKey = libraryAlbumId || releaseGroup.id;
                const tracks = albumTracks[trackKey] || null;
                const isLoadingTracks = loadingTracks[trackKey] || false;
                const albumInfo = status?.albumInfo;

                return (
                  <div
                    key={releaseGroup.id}
                    className="transition-colors"
                    style={{
                      backgroundColor: isExpanded ? "#2a2830" : "#211f27",
                    }}
                    onMouseEnter={(e) => {
                      if (!isExpanded) {
                        e.currentTarget.style.backgroundColor = "#25232b";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isExpanded) {
                        e.currentTarget.style.backgroundColor = "#211f27";
                      }
                    }}
                  >
                    <div
                      className={`flex items-center justify-between p-4 cursor-pointer`}
                      onClick={() =>
                        handleAlbumClick(releaseGroup.id, status?.libraryId)
                      }
                    >
                      <div className="flex-1 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAlbumClick(
                              releaseGroup.id,
                              status?.libraryId,
                            );
                          }}
                          className=" hover:text-gray-300 transition-colors"
                          style={{ color: "#c1c1c3" }}
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                        {albumCovers[releaseGroup.id] ? (
                          <img
                            src={albumCovers[releaseGroup.id]}
                            alt={releaseGroup.title}
                            className="w-12 h-12 flex-shrink-0 object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div
                            className="w-12 h-12 flex-shrink-0  flex items-center justify-center"
                            style={{ backgroundColor: "#211f27" }}
                          >
                            <Music
                              className="w-6 h-6 "
                              style={{ color: "#c1c1c3" }}
                            />
                          </div>
                        )}
                        <div className="flex-1">
                          <h3
                            className="font-semibold "
                            style={{ color: "#fff" }}
                          >
                            {releaseGroup.title}
                          </h3>
                          <div
                            className="flex items-center gap-3 mt-1 text-sm "
                            style={{ color: "#c1c1c3" }}
                          >
                            {releaseGroup["first-release-date"] && (
                              <span>
                                {
                                  releaseGroup["first-release-date"].split(
                                    "-",
                                  )[0]
                                }
                              </span>
                            )}
                            {releaseGroup["primary-type"] && (
                              <span className="badge badge-primary text-xs">
                                {releaseGroup["primary-type"]}
                              </span>
                            )}
                            {releaseGroup["secondary-types"] &&
                              releaseGroup["secondary-types"].length > 0 && (
                                <span
                                  className="badge text-xs"
                                  style={{
                                    backgroundColor: "#211f27",
                                    color: "#fff",
                                  }}
                                >
                                  {releaseGroup["secondary-types"].join(", ")}
                                </span>
                              )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {status ? (
                          status.status === "available" ||
                          status.status === "added" ? (
                            <>
                              <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase bg-green-500/20 text-green-400 cursor-default">
                                <CheckCircle className="w-3.5 h-3.5" />
                                {status.label || "Available"}
                              </span>
                              <div className="relative overflow-visible">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAlbumDropdownOpen(
                                      albumDropdownOpen === releaseGroup.id
                                        ? null
                                        : releaseGroup.id,
                                    );
                                  }}
                                  className="btn btn-secondary btn-sm p-2"
                                  title="Options"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </button>
                                {albumDropdownOpen === releaseGroup.id && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-10"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAlbumDropdownOpen(null);
                                      }}
                                    />
                                    <div
                                      className="absolute right-0 top-full mt-2 w-48  shadow-lg  z-20 py-1"
                                      style={{ backgroundColor: "#211f27" }}
                                    >
                                      <a
                                        href={`https://www.last.fm/music/${encodeURIComponent(artist.name)}/${encodeURIComponent(releaseGroup.title)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="w-full text-left px-4 py-2 text-sm  hover:bg-gray-900/50 transition-colors flex items-center"
                                        style={{ color: "#fff" }}
                                        onClick={() =>
                                          setAlbumDropdownOpen(null)
                                        }
                                      >
                                        <ExternalLink className="w-4 h-4 mr-2" />
                                        View on Last.fm
                                      </a>
                                      <div className="my-1" />
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteAlbumClick(
                                            releaseGroup.id,
                                            releaseGroup.title,
                                          );
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors flex items-center"
                                      >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Delete Album
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </>
                          ) : status.status === "processing" ||
                            status.status === "adding" ||
                            status.status === "searching" ||
                            status.status === "downloading" ||
                            status.status === "moving" ? (
                            <>
                              <span
                                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase cursor-default"
                                style={{
                                  backgroundColor: "#211f27",
                                  color: "#c1c1c3",
                                }}
                              >
                                <Loader className="w-3.5 h-3.5 animate-spin" />
                                {status.label || "Processing"}
                              </span>
                              <div className="relative overflow-visible">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAlbumDropdownOpen(
                                      albumDropdownOpen === releaseGroup.id
                                        ? null
                                        : releaseGroup.id,
                                    );
                                  }}
                                  className="btn btn-secondary btn-sm p-2"
                                  title="Options"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </button>
                                {albumDropdownOpen === releaseGroup.id && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-10"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAlbumDropdownOpen(null);
                                      }}
                                    />
                                    <div
                                      className="absolute right-0 top-full mt-2 w-48  shadow-lg  z-20 py-1"
                                      style={{ backgroundColor: "#211f27" }}
                                    >
                                      <a
                                        href={`https://www.last.fm/music/${encodeURIComponent(artist.name)}/${encodeURIComponent(releaseGroup.title)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="w-full text-left px-4 py-2 text-sm  hover:bg-gray-900/50 transition-colors flex items-center"
                                        style={{ color: "#fff" }}
                                        onClick={() =>
                                          setAlbumDropdownOpen(null)
                                        }
                                      >
                                        <ExternalLink className="w-4 h-4 mr-2" />
                                        View on Last.fm
                                      </a>
                                      <div className="my-1" />
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteAlbumClick(
                                            releaseGroup.id,
                                            releaseGroup.title,
                                          );
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors flex items-center"
                                      >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Delete Album
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRequestAlbum(
                                  releaseGroup.id,
                                  releaseGroup.title,
                                );
                              }}
                              disabled={requestingAlbum === releaseGroup.id}
                              className="btn btn-secondary btn-sm inline-flex items-center"
                            >
                              {requestingAlbum === releaseGroup.id ? (
                                <Loader className="w-4 h-4 animate-spin" />
                              ) : (
                                <Plus className="w-4 h-4" />
                              )}
                            </button>
                          )
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRequestAlbum(
                                releaseGroup.id,
                                releaseGroup.title,
                              );
                            }}
                            disabled={requestingAlbum === releaseGroup.id}
                            className="btn btn-secondary btn-sm inline-flex items-center"
                          >
                            {requestingAlbum === releaseGroup.id ? (
                              <Loader className="w-4 h-4 animate-spin" />
                            ) : (
                              <Plus className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div
                        className=" px-4 py-4 /50 overflow-hidden"
                        style={{ backgroundColor: "#211f27" }}
                      >
                        {/* Show tracks (from library or MusicBrainz) */}
                        <div>
                          {isLoadingTracks ? (
                            <div className="flex items-center justify-center py-8">
                              <Loader
                                className="w-6 h-6 animate-spin"
                                style={{ color: "#c1c1c3" }}
                              />
                            </div>
                          ) : tracks && tracks.length > 0 ? (
                            <div className="space-y-0">
                              {tracks.map((track, idx) => (
                                <div
                                  key={track.id || track.mbid || idx}
                                  className="flex items-center justify-between p-2 transition-colors"
                                  style={{
                                    backgroundColor:
                                      idx % 2 === 0
                                        ? "transparent"
                                        : "rgba(255, 255, 255, 0.02)",
                                  }}
                                >
                                  <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <span
                                      className="text-xs  w-6 flex-shrink-0"
                                      style={{ color: "#c1c1c3" }}
                                    >
                                      {track.trackNumber ||
                                        track.position ||
                                        idx + 1}
                                    </span>
                                    <span
                                      className="text-sm  truncate"
                                      style={{ color: "#fff" }}
                                    >
                                      {track.title ||
                                        track.trackName ||
                                        "Unknown Track"}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {track.length && (
                                      <span
                                        className="text-xs "
                                        style={{ color: "#c1c1c3" }}
                                      >
                                        {Math.floor(track.length / 60000)}:
                                        {Math.floor(
                                          (track.length % 60000) / 1000,
                                        )
                                          .toString()
                                          .padStart(2, "0")}
                                      </span>
                                    )}
                                    {track.hasFile ? (
                                      <CheckCircle className="w-4 h-4 text-green-500" />
                                    ) : status?.libraryId ? (
                                      <span
                                        className="text-xs "
                                        style={{ color: "#c1c1c3" }}
                                      >
                                        Missing
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p
                              className="text-sm  italic py-4"
                              style={{ color: "#c1c1c3" }}
                            >
                              No tracks available
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {(loadingSimilar || similarArtists.length > 0) && (
        <div className="mt-12">
          <h2
            className="text-2xl font-bold  mb-6 flex items-center"
            style={{ color: "#fff" }}
          >
            Similar Artists
            {loadingSimilar && (
              <Loader
                className="w-4 h-4 ml-2 animate-spin"
                style={{ color: "#c1c1c3" }}
              />
            )}
          </h2>
          {loadingSimilar ? (
            <div className="flex items-center justify-center py-12">
              <Loader
                className="w-8 h-8 animate-spin"
                style={{ color: "#c1c1c3" }}
              />
            </div>
          ) : similarArtists.length > 0 ? (
            <div className="flex items-start gap-2">
              <button
                onClick={() => {
                  if (similarArtistsScrollRef.current) {
                    similarArtistsScrollRef.current.scrollBy({
                      left: -320,
                      behavior: "smooth",
                    });
                  }
                }}
                className="flex-shrink-0 p-2 hover:bg-black/50 transition-colors"
                style={{
                  color: "#fff",
                  marginTop: "70px", // Center with 160px image (half height)
                }}
                aria-label="Scroll left"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div
                ref={similarArtistsScrollRef}
                className="flex overflow-x-auto pb-4 gap-4 scroll-smooth similar-artists-scroll flex-1"
                style={{
                  scrollbarWidth: "none",
                  msOverflowStyle: "none",
                }}
              >
                {similarArtists.map((similar) => (
                  <div
                    key={similar.id}
                    className="flex-shrink-0 w-40 group cursor-pointer"
                    onClick={() => navigate(`/artist/${similar.id}`)}
                  >
                    <div
                      className="relative aspect-square overflow-hidden  mb-2 shadow-sm group-hover:shadow-md transition-all"
                      style={{ backgroundColor: "#211f27" }}
                    >
                      <ArtistImage
                        src={similar.image}
                        mbid={similar.id}
                        alt={similar.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                      />

                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"></div>

                      {similar.match && (
                        <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 font-medium">
                          {similar.match}% Match
                        </div>
                      )}
                    </div>
                    <h3
                      className="font-medium text-sm  truncate transition-colors"
                      style={{ color: "#fff" }}
                    >
                      {similar.name}
                    </h3>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  if (similarArtistsScrollRef.current) {
                    similarArtistsScrollRef.current.scrollBy({
                      left: 320,
                      behavior: "smooth",
                    });
                  }
                }}
                className="flex-shrink-0 p-2 hover:bg-black/50 transition-colors"
                style={{
                  color: "#fff",
                  marginTop: "70px", // Center with 160px image (half height)
                }}
                aria-label="Scroll right"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && libraryArtist && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div
            className=" shadow-xl max-w-md w-full p-6"
            style={{ backgroundColor: "#211f27" }}
          >
            <h3 className="text-xl font-bold  mb-4" style={{ color: "#fff" }}>
              Remove Artist from Library
            </h3>
            <p className=" mb-6" style={{ color: "#fff" }}>
              Are you sure you want to remove{" "}
              <span className="font-semibold">
                {artist?.name || libraryArtist.artistName}
              </span>{" "}
              from library?
            </p>

            <div className="mb-6">
              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteFiles}
                  onChange={(e) => setDeleteFiles(e.target.checked)}
                  className="mt-1 form-checkbox h-5 w-5"
                  style={{ color: "#c1c1c3" }}
                />
                <div className="flex-1">
                  <span className=" font-medium" style={{ color: "#fff" }}>
                    Delete artist folder and files
                  </span>
                  <p className="text-sm  mt-1" style={{ color: "#c1c1c3" }}>
                    This will permanently delete the artist's folder and all
                    music files from your disk. This action cannot be undone.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={handleDeleteCancel}
                disabled={deletingArtist}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deletingArtist}
                className="btn btn-danger"
              >
                {deletingArtist ? (
                  <>
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                    Removing...
                  </>
                ) : (
                  "Remove Artist"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAlbumModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div
            className=" shadow-xl max-w-md w-full p-6"
            style={{ backgroundColor: "#211f27" }}
          >
            <h3 className="text-xl font-bold  mb-4" style={{ color: "#fff" }}>
              Delete Album from Library
            </h3>
            <p className=" mb-6" style={{ color: "#fff" }}>
              Are you sure you want to delete{" "}
              <span className="font-semibold">
                {showDeleteAlbumModal.title}
              </span>{" "}
              from library?
            </p>

            <div className="mb-6">
              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteAlbumFiles}
                  onChange={(e) => setDeleteAlbumFiles(e.target.checked)}
                  className="mt-1 form-checkbox h-5 w-5"
                  style={{ color: "#c1c1c3" }}
                />
                <div className="flex-1">
                  <span className=" font-medium" style={{ color: "#fff" }}>
                    Delete album folder and files
                  </span>
                  <p className="text-sm  mt-1" style={{ color: "#c1c1c3" }}>
                    This will permanently delete the album's folder and all
                    music files from your disk. This action cannot be undone.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={handleDeleteAlbumCancel}
                disabled={!!removingAlbum}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAlbumConfirm}
                disabled={!!removingAlbum}
                className="btn btn-danger"
              >
                {removingAlbum ? (
                  <>
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete Album"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ArtistDetailsPage;
