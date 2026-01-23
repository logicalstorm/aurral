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
  lookupArtistInLidarr,
  getLidarrAlbums,
  getLidarrTracks,
  updateLidarrAlbum,
  updateLidarrAlbumsMonitor,
  searchLidarrAlbum,
  getSimilarArtistsForArtist,
  lookupArtistsInLidarrBatch,
  getAppSettings,
  refreshLidarrArtist,
  getLidarrMetadataProfiles,
  addArtistToLidarr,
  deleteArtistFromLidarr,
  deleteAlbumFromLidarr,
  updateLidarrArtist,
  getLidarrArtist,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import AddArtistModal from "../components/AddArtistModal";
import ArtistImage from "../components/ArtistImage";

function ArtistDetailsPage() {
  const { mbid } = useParams();
  const navigate = useNavigate();
  const [artist, setArtist] = useState(null);
  const [coverImages, setCoverImages] = useState([]);
  const [lidarrArtist, setLidarrArtist] = useState(null);
  const [lidarrAlbums, setLidarrAlbums] = useState([]);
  const [similarArtists, setSimilarArtists] = useState([]);
  const [existingSimilar, setExistingSimilar] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [existsInLidarr, setExistsInLidarr] = useState(false);
  const [artistToAdd, setArtistToAdd] = useState(null);
  const [requestingAlbum, setRequestingAlbum] = useState(null);
  const [removingAlbum, setRemovingAlbum] = useState(null);
  const [albumDropdownOpen, setAlbumDropdownOpen] = useState(null);
  const [showDeleteAlbumModal, setShowDeleteAlbumModal] = useState(null);
  const [deleteAlbumFiles, setDeleteAlbumFiles] = useState(false);
  const [processingBulk, setProcessingBulk] = useState(false);
  const [expandedAlbum, setExpandedAlbum] = useState(null);
  const [albumTracks, setAlbumTracks] = useState({});
  const [loadingTracks, setLoadingTracks] = useState({});
  const [filterByMetadata, setFilterByMetadata] = useState(true);
  const [appSettings, setAppSettings] = useState(null);
  const [refreshingArtist, setRefreshingArtist] = useState(false);
  const [metadataProfiles, setMetadataProfiles] = useState([]);
  const [addingArtist, setAddingArtist] = useState(false);
  const [showMonitorDropdown, setShowMonitorDropdown] = useState(false);
  const [monitorOption, setMonitorOption] = useState("none");
  const [showRemoveDropdown, setShowRemoveDropdown] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deletingArtist, setDeletingArtist] = useState(false);
  const [showMonitorOptionMenu, setShowMonitorOptionMenu] = useState(false);
  const [updatingMonitor, setUpdatingMonitor] = useState(false);
  const [albumCovers, setAlbumCovers] = useState({});
  const [loadingCover, setLoadingCover] = useState(true);
  const [loadingSimilar, setLoadingSimilar] = useState(true);
  const [loadingLidarr, setLoadingLidarr] = useState(true);
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    const fetchArtistData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch basic artist data first - show page immediately after this
        const [artistData, settings] = await Promise.all([
          getArtistDetails(mbid),
          getAppSettings()
        ]);
        console.log("Artist data received:", artistData);
        if (!artistData || !artistData.id) {
          throw new Error("Invalid artist data received");
        }
        setArtist(artistData);
        setAppSettings(settings);
        setLoading(false); // Show page immediately with basic data

        // Load cover image in background
        setLoadingCover(true);
        getArtistCover(mbid)
          .then(coverData => {
            if (coverData.images && coverData.images.length > 0) {
              setCoverImages(coverData.images);
            }
          })
          .catch(err => {
            console.log("No cover art available");
          })
          .finally(() => setLoadingCover(false));

        // Load similar artists in background
        setLoadingSimilar(true);
        getSimilarArtistsForArtist(mbid)
          .then(similarData => {
            setSimilarArtists(similarData.artists || []);
            if (similarData.artists?.length > 0) {
              const similarMbids = similarData.artists.map((a) => a.id);
              return lookupArtistsInLidarrBatch(similarMbids);
            }
            return {};
          })
          .then(existingMap => {
            if (existingMap) {
              setExistingSimilar(existingMap);
            }
          })
          .catch(err => {
            console.error("Failed to fetch similar artists:", err);
          })
          .finally(() => setLoadingSimilar(false));

        // Load album covers in background (non-blocking)
        if (artistData["release-groups"] && artistData["release-groups"].length > 0) {
          const releaseGroupIds = artistData["release-groups"]
            .filter(rg => rg["primary-type"] === "Album" || rg["primary-type"] === "EP")
            .slice(0, 30)
            .map(rg => rg.id);
          
          const coverPromises = releaseGroupIds.map(async (rgId) => {
            try {
              const coverData = await getReleaseGroupCover(rgId);
              if (coverData.images && coverData.images.length > 0) {
                const front = coverData.images.find(img => img.front) || coverData.images[0];
                return { id: rgId, url: front.image };
              }
            } catch (err) {
            }
            return null;
          });
          
          Promise.all(coverPromises).then(results => {
            const covers = {};
            results.forEach(result => {
              if (result) covers[result.id] = result.url;
            });
            setAlbumCovers(prev => ({ ...prev, ...covers }));
          }).catch(() => {});
        }
        
        // Load Lidarr data in background - always fetch fresh data to get latest monitoring status
        setLoadingLidarr(true);
        lookupArtistInLidarr(mbid, true) // Force refresh to bypass cache
          .then(lookup => {
            setExistsInLidarr(lookup.exists);
            if (lookup.exists && lookup.artist) {
              return Promise.all([
                getLidarrArtist(lookup.artist.id, true).catch(err => { // Force refresh to get latest data
                  console.error("Failed to fetch full artist details:", err);
                  return lookup.artist;
                }),
                getLidarrMetadataProfiles().catch(err => {
                  console.error("Failed to fetch metadata profiles:", err);
                  return [];
                })
              ]).then(([fullArtist, profiles]) => {
                console.log("Full Lidarr artist data:", fullArtist);
                console.log("Monitoring fields:", {
                  monitorNewItems: fullArtist.monitorNewItems,
                  addOptions: fullArtist.addOptions,
                  monitored: fullArtist.monitored,
                });
                setLidarrArtist(fullArtist);
                setMetadataProfiles(profiles);
                return lookup.artist.id;
              });
            }
            return null;
          })
          .then(artistId => {
            if (artistId) {
              // Wait a bit for Lidarr to sync, then fetch albums
              setTimeout(() => {
                getLidarrAlbums(artistId)
                  .then(albums => {
                    console.log("Lidarr Albums:", albums);
                    setLidarrAlbums(albums);
                  })
                  .catch(err => {
                    console.log("Retrying album fetch...");
                    setTimeout(() => {
                      getLidarrAlbums(artistId)
                        .then(albums => setLidarrAlbums(albums))
                        .catch(e => {});
                    }, 2000);
                  });
              }, 1000);
            }
          })
          .catch(err => {
            console.error("Failed to lookup artist in Lidarr:", err);
          })
          .finally(() => setLoadingLidarr(false));
      } catch (err) {
        console.error("Error fetching artist data:", err);
        console.error("Error response:", err.response);
        console.error("Error message:", err.message);
        setError(
          err.response?.data?.message || err.response?.data?.error || err.message || "Failed to fetch artist details",
        );
        setLoading(false);
      }
    };

    fetchArtistData();
  }, [mbid]);
  const handleAddArtist = async () => {
    if (!artist || !appSettings) return;
    
    setAddingArtist(true);
    try {
      await addArtistToLidarr({
        foreignArtistId: artist.id,
        artistName: artist.name,
        qualityProfileId: appSettings.qualityProfileId,
        metadataProfileId: appSettings.metadataProfileId,
        rootFolderPath: appSettings.rootFolderPath,
        monitored: appSettings.monitored ?? false,
        monitor: monitorOption,
        searchForMissingAlbums: appSettings.searchForMissingAlbums ?? false,
        albumFolders: appSettings.albumFolders ?? true,
      });

      setExistsInLidarr(true);
      showSuccess(`Successfully added ${artist.name} to Lidarr!`);
      
      setTimeout(async () => {
        try {
          const lookup = await lookupArtistInLidarr(mbid, true); // Force refresh
          if (lookup.exists && lookup.artist) {
            try {
              const fullArtist = await getLidarrArtist(lookup.artist.id, true); // Force refresh
              setLidarrArtist(fullArtist);
            } catch (err) {
              console.error("Failed to fetch full artist details:", err);
              setLidarrArtist(lookup.artist);
            }
            const albums = await getLidarrAlbums(lookup.artist.id);
            setLidarrAlbums(albums);
            
            try {
              const profiles = await getLidarrMetadataProfiles();
              setMetadataProfiles(profiles);
            } catch (err) {
              console.error("Failed to fetch metadata profiles:", err);
            }
          }
        } catch (err) {
          console.error("Failed to refresh Lidarr data", err);
        }
      }, 1500);
    } catch (err) {
      showError(`Failed to add artist: ${err.response?.data?.message || err.message}`);
    } finally {
      setAddingArtist(false);
    }
  };

  const handleRefreshArtist = async () => {
    if (!lidarrArtist?.id) return;
    
    setRefreshingArtist(true);
    try {
      await refreshLidarrArtist(lidarrArtist.id);
      
      // Refetch the artist data to get latest monitoring status
      setTimeout(async () => {
        try {
          const refreshedArtist = await getLidarrArtist(lidarrArtist.id, true);
          setLidarrArtist(refreshedArtist);
          const albums = await getLidarrAlbums(lidarrArtist.id);
          setLidarrAlbums(albums);
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

  const getMetadataProfileName = () => {
    if (!lidarrArtist?.metadataProfileId || !metadataProfiles.length) return null;
    const profile = metadataProfiles.find(p => p.id === lidarrArtist.metadataProfileId);
    return profile?.name || null;
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
    if (!lidarrArtist?.id) return;

    setDeletingArtist(true);
    try {
      await deleteArtistFromLidarr(lidarrArtist.id, deleteFiles);
      setExistsInLidarr(false);
      setLidarrArtist(null);
      setLidarrAlbums([]);
      showSuccess(
        `Successfully removed ${artist?.name || 'artist'} from Lidarr${
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
    if (!lidarrArtist?.id) return;

    setUpdatingMonitor(true);
    try {
      // For existing artists, Lidarr uses monitorNewItems field
      // Send the full artist object with the updated monitorNewItems
      // Lidarr requires all fields to be present in PUT requests
      const updatedArtist = {
        ...lidarrArtist,
        monitorNewItems: newMonitorOption, // This is the key field for monitoring option
      };
      
      // Remove any fields that shouldn't be sent in updates
      delete updatedArtist.statistics;
      delete updatedArtist.images;
      delete updatedArtist.links;
      
      console.log("Updating artist with:", {
        id: lidarrArtist.id,
        monitorNewItems: newMonitorOption,
        currentValue: lidarrArtist.monitorNewItems,
      });
      
      const result = await updateLidarrArtist(lidarrArtist.id, updatedArtist);
      console.log("Update result from Lidarr:", result);
      
      // Refetch the artist from Lidarr to get the actual updated data
      const refreshedArtist = await getLidarrArtist(lidarrArtist.id, true);
      console.log("Refreshed artist after update:", {
        monitorNewItems: refreshedArtist.monitorNewItems,
        addOptions: refreshedArtist.addOptions,
      });
      setLidarrArtist(refreshedArtist);
      
      setShowMonitorOptionMenu(false);
      setShowRemoveDropdown(false);
      
      const monitorLabels = {
        none: "None (Artist Only)",
        all: "All Albums",
        future: "Future Albums",
        missing: "Missing Albums",
        latest: "Latest Album",
        first: "First Album",
      };
      
      showSuccess(`Monitor option updated to: ${monitorLabels[newMonitorOption]}`);
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
    if (!lidarrArtist) return "none";
    
    // If artist is not monitored at all, return "none" regardless of monitorNewItems
    // (Lidarr API sometimes returns stale monitorNewItems values)
    if (lidarrArtist.monitored === false) {
      return "none";
    }
    
    // For existing artists, Lidarr uses monitorNewItems field
    // This is an enum: "all", "none", "new", etc.
    if (lidarrArtist.monitorNewItems !== undefined && lidarrArtist.monitorNewItems !== null) {
      return lidarrArtist.monitorNewItems;
    }
    
    // Fallback to addOptions.monitor (used when adding new artists)
    if (lidarrArtist.addOptions?.monitor) {
      return lidarrArtist.addOptions.monitor;
    }
    
    // Default to "none" if not set
    return "none";
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

  const handleAddSuccess = async (addedArtist) => {
    setArtistToAdd(null);
    showSuccess(`Successfully added ${addedArtist.name} to Lidarr!`);
    
    if (addedArtist.id) {
      setExistingSimilar((prev) => ({ ...prev, [addedArtist.id]: true }));
    }
  };

  const handleRequestAlbum = async (albumId, title) => {
    setRequestingAlbum(albumId);
    try {
      const lidarrAlbum = lidarrAlbums.find(
        (a) => a.foreignAlbumId === albumId,
      );

      if (!lidarrAlbum) {
        throw new Error("Album not found in Lidarr");
      }

      await updateLidarrAlbum(lidarrAlbum.id, {
        ...lidarrAlbum,
        monitored: true,
      });

      await searchLidarrAlbum([lidarrAlbum.id]);

      setLidarrAlbums((prev) =>
        prev.map((a) =>
          a.id === lidarrAlbum.id ? { ...a, monitored: true } : a,
        ),
    );

      showSuccess(`Added album: ${title}`);
    } catch (err) {
      showError(`Failed to add album: ${err.message}`);
    } finally {
      setRequestingAlbum(null);
    }
  };

  const handleAlbumClick = async (releaseGroupId, lidarrAlbumId) => {
    if (expandedAlbum === releaseGroupId) {
      setExpandedAlbum(null);
      return;
    }

    setExpandedAlbum(releaseGroupId);

    // Only fetch Lidarr tracks if the album is in Lidarr
    if (lidarrAlbumId && !albumTracks[lidarrAlbumId]) {
      setLoadingTracks((prev) => ({ ...prev, [lidarrAlbumId]: true }));
      try {
        const tracks = await getLidarrTracks(lidarrAlbumId);
        setAlbumTracks((prev) => ({ ...prev, [lidarrAlbumId]: tracks }));
      } catch (err) {
        console.error("Failed to fetch tracks:", err);
        showError("Failed to fetch track list");
      } finally {
        setLoadingTracks((prev) => ({ ...prev, [lidarrAlbumId]: false }));
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
      const lidarrAlbum = lidarrAlbums.find(
        (a) => a.foreignAlbumId === albumId,
      );

      if (!lidarrAlbum) {
        throw new Error("Album not found in Lidarr");
      }

      setRemovingAlbum(albumId);
      await deleteAlbumFromLidarr(lidarrAlbum.id, deleteAlbumFiles);

      setLidarrAlbums((prev) =>
        prev.filter((a) => a.id !== lidarrAlbum.id),
      );

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

  // Helper function to check if a release group matches metadata profile filters
  const getArtistMetadataProfileTypes = () => {
    if (!lidarrArtist?.metadataProfileId || !metadataProfiles.length) {
      return appSettings?.metadataProfileReleaseTypes || null;
    }
    
    const profile = metadataProfiles.find(p => p.id === lidarrArtist.metadataProfileId);
    if (!profile) {
      return appSettings?.metadataProfileReleaseTypes || null;
    }
    
    const allowedTypes = [];
    if (profile.primaryAlbumTypes) {
      profile.primaryAlbumTypes.forEach(typeObj => {
        if (typeObj.allowed && typeObj.albumType?.name) {
          allowedTypes.push(typeObj.albumType.name);
        }
      });
    }
    
    return allowedTypes.length > 0 ? allowedTypes : (appSettings?.metadataProfileReleaseTypes || null);
  };

  const matchesMetadataProfile = (releaseGroup) => {
    if (!filterByMetadata) return true;
    
    const allowedTypes = getArtistMetadataProfileTypes();
    if (!allowedTypes || allowedTypes.length === 0) return true;
    
    if (!allowedTypes.includes(releaseGroup["primary-type"])) {
      return false;
    }
    
    if (releaseGroup["secondary-types"] && releaseGroup["secondary-types"].length > 0) {
      return releaseGroup["secondary-types"].every(secondaryType => 
        allowedTypes.includes(secondaryType)
      );
    }
    
    return true;
  };

  const handleMonitorAll = async () => {
    if (!lidarrAlbums.length) return;

    const visibleReleaseGroups = artist["release-groups"].filter(matchesMetadataProfile);
    
    const visibleMbids = new Set(visibleReleaseGroups.map(rg => rg.id));

    const unmonitored = lidarrAlbums.filter((a) => !a.monitored && visibleMbids.has(a.foreignAlbumId));

    if (unmonitored.length === 0) {
      showSuccess("No new unmonitored albums in current view!");
      return;
    }

    setProcessingBulk(true);
    try {
      const ids = unmonitored.map((a) => a.id);
      await updateLidarrAlbumsMonitor(ids, true);
      await searchLidarrAlbum(ids);

      setLidarrAlbums((prev) =>
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

  const getAlbumStatus = (releaseGroupId) => {
    if (!existsInLidarr || lidarrAlbums.length === 0) return null;

    const album = lidarrAlbums.find((a) => a.foreignAlbumId === releaseGroupId);

    if (!album) {
      return null;
    }

    const isComplete = album.statistics?.percentOfTracks === 100;
    const isAvailable = isComplete; // Available if 100% downloaded, regardless of monitored status
    const isProcessing = album.monitored && !isComplete;

    return { 
      status: isAvailable ? "available" : (isProcessing ? "processing" : "unmonitored"), 
      label: isAvailable ? "Available" : (isProcessing ? "Processing" : "Not Monitored"),
      lidarrId: album.id,
      albumInfo: album
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
        {existsInLidarr && (
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
          <div className="w-full md:w-64 h-64 flex-shrink-0 bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden relative">
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

              {loadingLidarr && existsInLidarr ? (
                <div className="flex items-center text-gray-700 dark:text-gray-300">
                  <Tag className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                  <span className="font-medium mr-2">Metadata Profile:</span>
                  <Loader className="w-4 h-4 animate-spin text-primary-600" />
                </div>
              ) : existsInLidarr && getMetadataProfileName() && (
                <div className="flex items-center text-gray-700 dark:text-gray-300">
                  <Tag className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                  <span className="font-medium mr-2">Metadata Profile:</span>
                  <span>{getMetadataProfileName()}</span>
                </div>
              )}

              {loadingLidarr && existsInLidarr ? (
                <div className="flex items-center text-gray-700 dark:text-gray-300">
                  <Radio className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                  <span className="font-medium mr-2">Monitoring:</span>
                  <Loader className="w-4 h-4 animate-spin text-primary-600" />
                </div>
              ) : existsInLidarr && (
                <div className="flex items-center text-gray-700 dark:text-gray-300">
                  <Radio className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                  <span className="font-medium mr-2">Monitoring:</span>
                  <span>{getMonitorOptionLabel(getCurrentMonitorOption())}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              {loadingLidarr ? (
                <div className="btn btn-secondary inline-flex items-center" disabled>
                  <Loader className="w-5 h-5 mr-2 animate-spin" />
                  Loading...
                </div>
              ) : existsInLidarr ? (
                <>
                  <div className="relative inline-flex">
                    <button className="btn btn-success inline-flex items-center rounded-r-none border-r border-green-400 dark:border-green-600">
                      <CheckCircle className="w-5 h-5 mr-2" />
                      In Your Library
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowRemoveDropdown(!showRemoveDropdown)}
                        className="btn btn-success inline-flex items-center rounded-l-none px-2 border-l border-green-400 dark:border-green-600 hover:bg-green-600"
                        title="Options"
                      >
                        <ChevronDown className={`w-4 h-7 transition-transform ${showRemoveDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      {showRemoveDropdown && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setShowRemoveDropdown(false)}
                          />
                          <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1">
                            {!showMonitorOptionMenu ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowMonitorOptionMenu(true);
                                  }}
                                  disabled={updatingMonitor}
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-between"
                                >
                                  <span>Change Monitor Option</span>
                                  <ChevronDown className="w-4 h-4" />
                                </button>
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
                                  Remove from Lidarr
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                  <button
                                    type="button"
                                    onClick={() => setShowMonitorOptionMenu(false)}
                                    className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 flex items-center"
                                  >
                                    <ArrowLeft className="w-4 h-4 mr-1" />
                                    Back
                                  </button>
                                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                    Monitor Option
                                  </span>
                                  <div className="w-16" />
                                </div>
                                {[
                                  { value: "none", label: "None (Artist Only)" },
                                  { value: "all", label: "All Albums" },
                                  { value: "future", label: "Future Albums" },
                                  { value: "missing", label: "Missing Albums" },
                                  { value: "latest", label: "Latest Album" },
                                  { value: "first", label: "First Album" },
                                ].map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => handleUpdateMonitorOption(option.value)}
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
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="relative inline-flex">
                  <button
                    onClick={handleAddArtist}
                    disabled={addingArtist || !appSettings}
                    className="btn btn-primary inline-flex items-center rounded-r-none border-r border-primary-400 dark:border-primary-600"
                  >
                    {addingArtist ? (
                      <Loader className="w-5 h-5 mr-2 animate-spin" />
                    ) : (
                      <Plus className="w-5 h-5 mr-2" />
                    )}
                    Add to Lidarr
                  </button>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowMonitorDropdown(!showMonitorDropdown)}
                      disabled={addingArtist || !appSettings}
                      className="btn btn-primary inline-flex items-center rounded-l-none px-2 border-l border-primary-400 dark:border-primary-600 hover:bg-primary-600"
                      title="Monitor Options"
                    >
                      <ChevronDown className={`w-4 h-7 transition-transform ${showMonitorDropdown ? 'rotate-180' : ''}`} />
                    </button>
                    {showMonitorDropdown && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setShowMonitorDropdown(false)}
                        />
                        <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1">
                          <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              Monitor Option
                            </p>
                          </div>
                          {[
                            { value: "none", label: "None (Artist Only)" },
                            { value: "all", label: "All Albums" },
                            { value: "future", label: "Future Albums" },
                            { value: "missing", label: "Missing Albums" },
                            { value: "latest", label: "Latest Album" },
                            { value: "first", label: "First Album" },
                          ].map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                setMonitorOption(option.value);
                                setShowMonitorDropdown(false);
                              }}
                              className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                                monitorOption === option.value
                                  ? "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-medium"
                                  : "text-gray-700 dark:text-gray-300"
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
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
                    onClick={() => navigate(`/search?q=${encodeURIComponent(genre.name)}&type=tag`)}
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
                    onClick={() => navigate(`/search?q=${encodeURIComponent(tag.name)}&type=tag`)}
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
              Albums & Releases ({
                artist["release-groups"].filter(matchesMetadataProfile).length
              })
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center space-x-2 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors mr-2">
                <input
                  type="checkbox"
                  checked={filterByMetadata}
                  onChange={(e) => setFilterByMetadata(e.target.checked)}
                  className="form-checkbox h-4 w-4 text-primary-600 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                  Filter by Metadata Profile
                </span>
              </label>

              {existsInLidarr && (
                <button
                  onClick={handleMonitorAll}
                  disabled={processingBulk}
                  className="btn btn-outline-primary btn-sm flex items-center justify-center"
                >
                  {processingBulk ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin mr-2" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Add All Filtered
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {artist["release-groups"]
              .filter(matchesMetadataProfile)
              .sort((a, b) => {
                const dateA = a["first-release-date"] || "";
                const dateB = b["first-release-date"] || "";
                return dateB.localeCompare(dateA);
              })
              .map((releaseGroup) => {
                const status = getAlbumStatus(releaseGroup.id);
                const isExpanded = expandedAlbum === releaseGroup.id;
                const lidarrAlbumId = status?.lidarrId;
                const tracks = lidarrAlbumId ? albumTracks[lidarrAlbumId] : null;
                const isLoadingTracks = lidarrAlbumId ? loadingTracks[lidarrAlbumId] : false;
                const albumInfo = status?.albumInfo;
                
                return (
                  <div
                    key={releaseGroup.id}
                    className="bg-gray-50 dark:bg-gray-800/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div
                      className={`flex items-center justify-between p-4 cursor-pointer ${!isExpanded ? 'rounded-lg' : 'rounded-t-lg'}`}
                      onClick={() => handleAlbumClick(releaseGroup.id, status?.lidarrId)}
                    >
                      <div className="flex-1 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAlbumClick(releaseGroup.id, status?.lidarrId);
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
                            className="w-12 h-12 flex-shrink-0 rounded object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="w-12 h-12 flex-shrink-0 rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
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
                                {releaseGroup["first-release-date"].split("-")[0]}
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
                        status.status === "available" ? (
                          <>
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 cursor-default">
                              <CheckCircle className="w-3.5 h-3.5" />
                              Available
                            </span>
                            <div className="relative overflow-visible">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAlbumDropdownOpen(albumDropdownOpen === releaseGroup.id ? null : releaseGroup.id);
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
                                  <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1">
                                    <a
                                      href={`https://www.last.fm/music/${encodeURIComponent(artist.name)}/${encodeURIComponent(releaseGroup.title)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center"
                                      onClick={() => setAlbumDropdownOpen(null)}
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
                        ) : status.status === "processing" ? (
                          <>
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 cursor-default">
                              <Loader className="w-3.5 h-3.5 animate-spin" />
                              Processing
                            </span>
                            <div className="relative overflow-visible">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAlbumDropdownOpen(albumDropdownOpen === releaseGroup.id ? null : releaseGroup.id);
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
                                  <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1">
                                    <a
                                      href={`https://www.last.fm/music/${encodeURIComponent(artist.name)}/${encodeURIComponent(releaseGroup.title)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center"
                                      onClick={() => setAlbumDropdownOpen(null)}
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
                      ) : existsInLidarr ? (
                        <span className="text-xs text-gray-400 italic">
                          Not in Lidarr
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">
                          Add Artist First
                        </span>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-4 bg-gray-100 dark:bg-gray-900/50 overflow-hidden rounded-b-lg">
                      {/* Show Lidarr album info if available */}
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
                                  <span className="text-gray-600 dark:text-gray-400">Tracks:</span>
                                  <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                    {albumInfo.statistics.trackCount || 0}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-600 dark:text-gray-400">Size:</span>
                                  <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                    {albumInfo.statistics.sizeOnDisk
                                      ? `${(albumInfo.statistics.sizeOnDisk / 1024 / 1024).toFixed(2)} MB`
                                      : "N/A"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-600 dark:text-gray-400">Completion:</span>
                                  <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                    {albumInfo.statistics.percentOfTracks || 0}%
                                  </span>
                                </div>
                              </>
                            )}
                            {albumInfo.releaseDate && (
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Release Date:</span>
                                <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                  {albumInfo.releaseDate}
                                </span>
                              </div>
                            )}
                            {albumInfo.albumType && (
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Type:</span>
                                <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                  {albumInfo.albumType}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Show release group info from MusicBrainz if not in Lidarr */}
                      {!status?.lidarrId && (
                        <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center">
                            <FileMusic className="w-4 h-4 mr-2" />
                            Release Information
                          </h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                            {releaseGroup["first-release-date"] && (
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Release Date:</span>
                                <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                  {releaseGroup["first-release-date"]}
                                </span>
                              </div>
                            )}
                            {releaseGroup["primary-type"] && (
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Type:</span>
                                <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                  {releaseGroup["primary-type"]}
                                </span>
                              </div>
                            )}
                            {releaseGroup["secondary-types"] && releaseGroup["secondary-types"].length > 0 && (
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Secondary Types:</span>
                                <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                                  {releaseGroup["secondary-types"].join(", ")}
                                </span>
                              </div>
                            )}
                          </div>
                          {!existsInLidarr && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 italic mt-3">
                              Add this artist to your library to see track information and download albums.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Show Lidarr tracks if available */}
                      {status?.lidarrId && (
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
                                  key={track.id || idx}
                                  className="flex items-center justify-between p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                                >
                                  <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <span className="text-xs text-gray-500 dark:text-gray-400 w-6 flex-shrink-0">
                                      {track.trackNumber || idx + 1}
                                    </span>
                                    <span className="text-sm text-gray-900 dark:text-gray-100 truncate">
                                      {track.title || "Unknown Track"}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {track.duration && (
                                      <span className="text-xs text-gray-500 dark:text-gray-400">
                                        {Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2, '0')}
                                      </span>
                                    )}
                                    {track.hasFile ? (
                                      <CheckCircle className="w-4 h-4 text-green-500" />
                                    ) : (
                                      <span className="text-xs text-gray-400">Missing</span>
                                    )}
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
                      )}
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
                <div className="relative aspect-square rounded-xl overflow-hidden bg-gray-200 dark:bg-gray-800 mb-2 shadow-sm group-hover:shadow-md transition-all">
                  <ArtistImage
                    src={similar.image}
                    mbid={similar.id}
                    alt={similar.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                  />

                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    {!existingSimilar[similar.id] && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setArtistToAdd(similar);
                        }}
                        className="p-1.5 bg-primary-500 text-white rounded-full hover:bg-primary-600 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {existingSimilar[similar.id] && (
                    <div className="absolute top-2 right-2 bg-green-500 text-white p-1 rounded-full shadow-md">
                      <CheckCircle className="w-2.5 h-2.5" />
                    </div>
                  )}

                  {similar.match && (
                    <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 rounded font-medium">
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

      {artistToAdd && (
        <AddArtistModal
          artist={{
            id: artistToAdd.id,
            name: artistToAdd.name,
          }}
          onClose={() => setArtistToAdd(null)}
          onSuccess={handleAddSuccess}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && lidarrArtist && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              Remove Artist from Lidarr
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              Are you sure you want to remove{" "}
              <span className="font-semibold">{artist?.name || lidarrArtist.artistName}</span>{" "}
              from Lidarr?
            </p>

            <div className="mb-6">
              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteFiles}
                  onChange={(e) => setDeleteFiles(e.target.checked)}
                  className="mt-1 form-checkbox h-5 w-5 text-primary-600 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                />
                <div className="flex-1">
                  <span className="text-gray-900 dark:text-gray-100 font-medium">
                    Delete artist folder and files
                  </span>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    This will permanently delete the artist's folder and all music
                    files from your disk. This action cannot be undone.
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
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              Delete Album from Lidarr
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              Are you sure you want to delete{" "}
              <span className="font-semibold">{showDeleteAlbumModal.title}</span>{" "}
              from Lidarr?
            </p>

            <div className="mb-6">
              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteAlbumFiles}
                  onChange={(e) => setDeleteAlbumFiles(e.target.checked)}
                  className="mt-1 form-checkbox h-5 w-5 text-primary-600 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                />
                <div className="flex-1">
                  <span className="text-gray-900 dark:text-gray-100 font-medium">
                    Delete album folder and files
                  </span>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    This will permanently delete the album's folder and all music
                    files from your disk. This action cannot be undone.
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


