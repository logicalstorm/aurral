import { useState, useEffect } from "react";
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
  Trash2,
  Radio,
  FileMusic,
  MoreVertical,
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

function ArtistDetailsPage() {
  const { mbid } = useParams();
  const navigate = useNavigate();
  const [artist, setArtist] = useState(null);
  const [coverImages, setCoverImages] = useState([]);
  const [libraryArtist, setLibraryArtist] = useState(null);
  const [libraryAlbums, setLibraryAlbums] = useState([]);
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
  const [selectedReleaseTypes, setSelectedReleaseTypes] =
    useState(allReleaseTypes);
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
    const fetchArtistData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch basic artist data first - show page immediately after this
        const [artistData, settings] = await Promise.all([
          getArtistDetails(mbid),
          getAppSettings(),
        ]);

        // Initialize release type filters from settings (but don't use settings for filtering anymore)
        // Always start with all types selected
        setSelectedReleaseTypes(allReleaseTypes);
        if (!artistData || !artistData.id) {
          throw new Error("Invalid artist data received");
        }
        setArtist(artistData);
        setAppSettings(settings);
        setLoading(false); // Show page immediately with basic data

        // Load cover image in background
        setLoadingCover(true);
        getArtistCover(mbid)
          .then((coverData) => {
            if (coverData.images && coverData.images.length > 0) {
              setCoverImages(coverData.images);
            }
          })
          .catch((err) => {
          })
          .finally(() => setLoadingCover(false));

        // Load similar artists in background
        setLoadingSimilar(true);
        getSimilarArtistsForArtist(mbid)
          .then((similarData) => {
            setSimilarArtists(similarData.artists || []);
          })
          .catch((err) => {
            console.error("Failed to fetch similar artists:", err);
          })
          .finally(() => setLoadingSimilar(false));

        // Load album covers in background (non-blocking)
        if (
          artistData["release-groups"] &&
          artistData["release-groups"].length > 0
        ) {
          const releaseGroupIds = artistData["release-groups"]
            .filter(
              (rg) =>
                rg["primary-type"] === "Album" || rg["primary-type"] === "EP",
            )
            .slice(0, 30)
            .map((rg) => rg.id);

          const coverPromises = releaseGroupIds.map(async (rgId) => {
            try {
              const coverData = await getReleaseGroupCover(rgId);
              if (coverData.images && coverData.images.length > 0) {
                const front =
                  coverData.images.find((img) => img.front) ||
                  coverData.images[0];
                return { id: rgId, url: front.image };
              }
            } catch (err) {}
            return null;
          });

          Promise.all(coverPromises)
            .then((results) => {
              const covers = {};
              results.forEach((result) => {
                if (result) covers[result.id] = result.url;
              });
              setAlbumCovers((prev) => ({ ...prev, ...covers }));
            })
            .catch(() => {});
        }

        // Load library data in background
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
      } catch (err) {
        console.error("Error fetching artist data:", err);
        console.error("Error response:", err.response);
        console.error("Error message:", err.message);
        setError(
          err.response?.data?.message ||
            err.response?.data?.error ||
            err.message ||
            "Failed to fetch artist details",
        );
        setLoading(false);
      }
    };

    fetchArtistData();
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
          setLibraryAlbums(albums);
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
        setLibraryAlbums(albums);
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
          setLibraryAlbums(albums);
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
          setLibraryAlbums((prev) => [...prev, libraryAlbum]);
        } catch (err) {
          // If that fails, try to refresh artist to get albums
          await refreshLibraryArtist(
            currentLibraryArtist.mbid || currentLibraryArtist.foreignArtistId,
          );
          const albums = await getLibraryAlbums(currentLibraryArtist.id);
          setLibraryAlbums(albums);
          libraryAlbum = albums.find(
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

    // Check primary type
    if (selectedReleaseTypes.includes(releaseGroup["primary-type"])) {
      return true;
    }

    // Check secondary types
    if (
      releaseGroup["secondary-types"] &&
      releaseGroup["secondary-types"].length > 0
    ) {
      return releaseGroup["secondary-types"].some((secondaryType) =>
        selectedReleaseTypes.includes(secondaryType),
      );
    }

    return false;
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
        <Loader className="w-12 h-12 text-primary-600 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="text-center py-12">
          <Music className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-200 mb-2">
            Error Loading Artist
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">{error}</p>
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
          <div className="w-full md:w-64 h-64 flex-shrink-0 bg-gray-200 dark:bg-gray-800 overflow-hidden relative">
            {loadingCover ? (
              <div className="w-full h-full flex items-center justify-center">
                <Loader className="w-12 h-12 text-primary-600 animate-spin" />
              </div>
            ) : coverImage ? (
              <img
                src={coverImage}
                alt={artist.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Music className="w-24 h-24 text-gray-400 dark:text-gray-600" />
              </div>
            )}
          </div>

          <div className="flex-1">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {artist.name}
            </h1>

            {artist["sort-name"] && artist["sort-name"] !== artist.name && (
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">
                {artist["sort-name"]}
              </p>
            )}

            {artist.disambiguation && (
              <p className="text-gray-600 dark:text-gray-400 italic mb-4">
                {artist.disambiguation}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {artist.type && (
                <div className="flex items-center text-gray-700 dark:text-gray-300">
                  <Music className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                  <span className="font-medium mr-2">Type:</span>
                  <span>{getArtistType(artist.type)}</span>
                </div>
              )}

              {lifeSpan && (
                <div className="flex items-center text-gray-700 dark:text-gray-300">
                  <Calendar className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                  <span className="font-medium mr-2">Active:</span>
                  <span>{lifeSpan}</span>
                </div>
              )}

              {artist.country && (
                <div className="flex items-center text-gray-700 dark:text-gray-300">
                  <MapPin className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                  <span className="font-medium mr-2">Country:</span>
                  <span>{artist.country}</span>
                </div>
              )}

              {artist.area && artist.area.name && (
                <div className="flex items-center text-gray-700 dark:text-gray-300">
                  <MapPin className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                  <span className="font-medium mr-2">Area:</span>
                  <span>{artist.area.name}</span>
                </div>
              )}

              {loadingLibrary && existsInLibrary ? (
                <div className="flex items-center text-gray-700 dark:text-gray-300">
                  <Radio className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                  <span className="font-medium mr-2">Monitoring:</span>
                  <Loader className="w-4 h-4 animate-spin text-primary-600" />
                </div>
              ) : (
                existsInLibrary && (
                  <div className="flex items-center text-gray-700 dark:text-gray-300">
                    <Radio className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
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
                    <button className="btn btn-success inline-flex items-center border-r border-green-400 dark:border-green-600">
                      <CheckCircle className="w-5 h-5 mr-2" />
                      In Your Library
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setShowRemoveDropdown(!showRemoveDropdown)
                        }
                        className="btn btn-success inline-flex items-center px-2 border-l border-green-400 dark:border-green-600 hover:bg-green-600"
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
                            className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1"
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
                              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-between"
                            >
                              <span>Change Monitor Option</span>
                              <ChevronDown
                                className={`w-4 h-4 transition-transform ${showMonitorOptionMenu ? "rotate-180" : ""}`}
                              />
                            </button>

                            {showMonitorOptionMenu && (
                              <>
                                <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
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
                                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                                      getCurrentMonitorOption() === option.value
                                        ? "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-medium"
                                        : "text-gray-700 dark:text-gray-300"
                                    }`}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </>
                            )}

                            <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                            <button
                              type="button"
                              onClick={() => {
                                handleDeleteClick();
                                setShowRemoveDropdown(false);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center"
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
                  className="btn btn-primary inline-flex items-center"
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
                    className="badge badge-primary text-sm px-3 py-1 hover:opacity-80 cursor-pointer transition-opacity"
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
                    className="badge bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm px-3 py-1 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                    title={`View artists with tag: ${tag.name}`}
                  >
                    {tag.name}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {artist["release-groups"] && artist["release-groups"].length > 0 && (
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Albums & Releases (
              {artist["release-groups"].filter(matchesReleaseTypeFilter).length}
              )
            </h2>
            <div className="flex items-center gap-3">
              {/* Filter Dropdown Button */}
              <div className="relative">
                <button
                  onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                  className="btn btn-outline-secondary btn-sm flex items-center gap-2 px-3 py-2"
                >
                  <Tag className="w-4 h-4" />
                  <span className="text-sm">Filter</span>
                  {hasActiveFilters() && (
                    <span className="bg-primary-500 text-white text-xs px-1.5 py-0.5 min-w-[18px] h-[18px] flex items-center justify-center">
                      {allReleaseTypes.length - selectedReleaseTypes.length}
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
                    <div className="absolute right-0 top-full mt-2 z-20 bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 p-4 min-w-[280px]">
                      <div className="space-y-4">
                        {/* Primary Types */}
                        <div>
                          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Primary Types
                          </h3>
                          <div className="space-y-2">
                            {primaryReleaseTypes.map((type) => (
                              <label
                                key={type}
                                className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 px-2 py-1.5 transition-colors"
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
                                  className="form-checkbox h-4 w-4 text-primary-600 border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                                />
                                <span className="text-sm text-gray-700 dark:text-gray-300">
                                  {type}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Divider */}
                        <div className="border-t border-gray-200 dark:border-gray-700" />

                        {/* Secondary Types */}
                        <div>
                          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Secondary Types
                          </h3>
                          <div className="space-y-2">
                            {secondaryReleaseTypes.map((type) => (
                              <label
                                key={type}
                                className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 px-2 py-1.5 transition-colors"
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
                                  className="form-checkbox h-4 w-4 text-primary-600 border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                                />
                                <span className="text-sm text-gray-700 dark:text-gray-300">
                                  {type}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                setSelectedReleaseTypes(allReleaseTypes)
                              }
                              className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                            >
                              Select All
                            </button>
                            <span className="text-gray-300 dark:text-gray-600">
                              |
                            </span>
                            <button
                              onClick={() => setSelectedReleaseTypes([])}
                              className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
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
                    className="bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
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
                          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
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
                          <div className="w-12 h-12 flex-shrink-0 bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                            <Music className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                          </div>
                        )}
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                            {releaseGroup.title}
                          </h3>
                          <div className="flex items-center gap-3 mt-1 text-sm text-gray-600 dark:text-gray-400">
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
                                <span className="badge bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs">
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
                              <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 cursor-default">
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
                                    <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1">
                                      <a
                                        href={`https://www.last.fm/music/${encodeURIComponent(artist.name)}/${encodeURIComponent(releaseGroup.title)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center"
                                        onClick={() =>
                                          setAlbumDropdownOpen(null)
                                        }
                                      >
                                        <ExternalLink className="w-4 h-4 mr-2" />
                                        View on Last.fm
                                      </a>
                                      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteAlbumClick(
                                            releaseGroup.id,
                                            releaseGroup.title,
                                          );
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center"
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
                              <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 cursor-default">
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
                                    <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1">
                                      <a
                                        href={`https://www.last.fm/music/${encodeURIComponent(artist.name)}/${encodeURIComponent(releaseGroup.title)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center"
                                        onClick={() =>
                                          setAlbumDropdownOpen(null)
                                        }
                                      >
                                        <ExternalLink className="w-4 h-4 mr-2" />
                                        View on Last.fm
                                      </a>
                                      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteAlbumClick(
                                            releaseGroup.id,
                                            releaseGroup.title,
                                          );
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center"
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
                              className="btn btn-primary btn-sm"
                            >
                              {requestingAlbum === releaseGroup.id ? (
                                <Loader className="w-4 h-4 animate-spin" />
                              ) : (
                                "Add"
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
                            className="btn btn-primary btn-sm"
                          >
                            {requestingAlbum === releaseGroup.id ? (
                              <Loader className="w-4 h-4 animate-spin" />
                            ) : (
                              "Add"
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-4 bg-gray-100 dark:bg-gray-900/50 overflow-hidden">
                        {/* Show library album info if available */}
                        {albumInfo && (
                          <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center">
                              <FileMusic className="w-4 h-4 mr-2" />
                              Album Information
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                              {albumInfo.statistics && (
                                <>
                                  <div>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      Tracks:
                                    </span>
                                    <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                      {albumInfo.statistics.trackCount || 0}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      Size:
                                    </span>
                                    <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                      {albumInfo.statistics.sizeOnDisk
                                        ? `${(albumInfo.statistics.sizeOnDisk / 1024 / 1024).toFixed(2)} MB`
                                        : "N/A"}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      Completion:
                                    </span>
                                    <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                      {albumInfo.statistics.percentOfTracks ||
                                        0}
                                      %
                                    </span>
                                  </div>
                                </>
                              )}
                              {albumInfo.releaseDate && (
                                <div>
                                  <span className="text-gray-600 dark:text-gray-400">
                                    Release Date:
                                  </span>
                                  <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                    {albumInfo.releaseDate}
                                  </span>
                                </div>
                              )}
                              {albumInfo.albumType && (
                                <div>
                                  <span className="text-gray-600 dark:text-gray-400">
                                    Type:
                                  </span>
                                  <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                    {albumInfo.albumType}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Show release group info from MusicBrainz if not in library */}
                        {!status?.libraryId && (
                          <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center">
                              <FileMusic className="w-4 h-4 mr-2" />
                              Release Information
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                              {releaseGroup["first-release-date"] && (
                                <div>
                                  <span className="text-gray-600 dark:text-gray-400">
                                    Release Date:
                                  </span>
                                  <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                    {releaseGroup["first-release-date"]}
                                  </span>
                                </div>
                              )}
                              {releaseGroup["primary-type"] && (
                                <div>
                                  <span className="text-gray-600 dark:text-gray-400">
                                    Type:
                                  </span>
                                  <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                    {releaseGroup["primary-type"]}
                                  </span>
                                </div>
                              )}
                              {releaseGroup["secondary-types"] &&
                                releaseGroup["secondary-types"].length > 0 && (
                                  <div>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      Secondary Types:
                                    </span>
                                    <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                      {releaseGroup["secondary-types"].join(
                                        ", ",
                                      )}
                                    </span>
                                  </div>
                                )}
                            </div>
                          </div>
                        )}

                        {/* Show tracks (from library or MusicBrainz) */}
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                            Tracks
                          </h4>
                          {isLoadingTracks ? (
                            <div className="flex items-center justify-center py-8">
                              <Loader className="w-6 h-6 text-primary-600 animate-spin" />
                            </div>
                          ) : tracks && tracks.length > 0 ? (
                            <div className="space-y-1 max-h-64 overflow-y-auto">
                              {tracks.map((track, idx) => (
                                <div
                                  key={track.id || track.mbid || idx}
                                  className="flex items-center justify-between p-2 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                                >
                                  <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <span className="text-xs text-gray-500 dark:text-gray-400 w-6 flex-shrink-0">
                                      {track.trackNumber ||
                                        track.position ||
                                        idx + 1}
                                    </span>
                                    <span className="text-sm text-gray-900 dark:text-gray-100 truncate">
                                      {track.title ||
                                        track.trackName ||
                                        "Unknown Track"}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {track.length && (
                                      <span className="text-xs text-gray-500 dark:text-gray-400">
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
                                      <span className="text-xs text-gray-400">
                                        Missing
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500 dark:text-gray-400 italic py-4">
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
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center">
            <Sparkles className="w-6 h-6 mr-2 text-primary-500" />
            Similar Artists
            {loadingSimilar && (
              <Loader className="w-4 h-4 ml-2 text-primary-600 animate-spin" />
            )}
          </h2>
          {loadingSimilar ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-8 h-8 text-primary-600 animate-spin" />
            </div>
          ) : similarArtists.length > 0 ? (
            <div className="flex overflow-x-auto pb-4 gap-4 no-scrollbar">
              {similarArtists.map((similar) => (
                <div
                  key={similar.id}
                  className="flex-shrink-0 w-40 group cursor-pointer"
                  onClick={() => navigate(`/artist/${similar.id}`)}
                >
                  <div className="relative aspect-square overflow-hidden bg-gray-200 dark:bg-gray-800 mb-2 shadow-sm group-hover:shadow-md transition-all">
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
                  <h3 className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate group-hover:text-primary-500 transition-colors">
                    {similar.name}
                  </h3>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && libraryArtist && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              Remove Artist from Library
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
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
                  className="mt-1 form-checkbox h-5 w-5 text-primary-600 border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                />
                <div className="flex-1">
                  <span className="text-gray-900 dark:text-gray-100 font-medium">
                    Delete artist folder and files
                  </span>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
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
          <div className="bg-white dark:bg-gray-800 shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              Delete Album from Library
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
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
                  className="mt-1 form-checkbox h-5 w-5 text-primary-600 border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                />
                <div className="flex-1">
                  <span className="text-gray-900 dark:text-gray-100 font-medium">
                    Delete album folder and files
                  </span>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
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
