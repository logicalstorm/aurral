import { useState, useEffect, useMemo, useRef } from "react";
import {
  getArtistDetails,
  getArtistCover,
  lookupArtistInLibrary,
  getLibraryAlbums,
  getLibraryArtist,
  getSimilarArtistsForArtist,
  getAppSettings,
  getReleaseGroupCoversBatch,
  getStoredAuth,
  readLibraryLookupCache,
} from "../../../utils/api";
import { emptyArtistShape } from "../constants";

const buildReleaseGroupCoverRequest = (
  rgId,
  artist,
  libraryAlbums,
  pageArtistName,
) => {
  const releaseGroup =
    artist?.["release-groups"]?.find((item) => item?.id === rgId) ||
    artist?.["appears-on-release-groups"]?.find((item) => item?.id === rgId);
  const libraryAlbum = libraryAlbums?.find(
    (album) => (album.mbid || album.foreignAlbumId) === rgId,
  );
  const appearsOnArtist =
    releaseGroup?.["artist-credit"]?.[0]?.name ||
    releaseGroup?.["artist-credit"]?.[0]?.artist?.name ||
    "";
  return {
    mbid: rgId,
    artistName: appearsOnArtist || pageArtistName || "",
    albumTitle: releaseGroup?.title || libraryAlbum?.albumName || "",
  };
};

const buildInitialArtist = (mbid, artistNameFromNav) =>
  mbid
    ? {
        id: mbid,
        name: artistNameFromNav || "Loading artist",
        "sort-name": artistNameFromNav || "Loading artist",
        ...emptyArtistShape,
        "release-groups": [],
        "appears-on-release-groups": [],
      }
    : null;

const normalizeReleaseTypesSelection = (selectedReleaseTypes = []) =>
  [
    ...new Set(
      (Array.isArray(selectedReleaseTypes) ? selectedReleaseTypes : []).filter(
        Boolean,
      ),
    ),
  ].sort();

const EMPTY_ARRAY = [];

const normalizePositiveLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const isReleaseTypeSelectionCovered = (
  selectedReleaseTypes = [],
  fetchedReleaseTypes = [],
) => {
  const fetched = new Set(normalizeReleaseTypesSelection(fetchedReleaseTypes));
  return normalizeReleaseTypesSelection(selectedReleaseTypes).every((type) =>
    fetched.has(type),
  );
};

export function useArtistDetailsStream(
  mbid,
  artistNameFromNav,
  selectedReleaseTypes = [],
  {
    visibleCoverIds = EMPTY_ARRAY,
    initialLibraryHint = null,
    appearsOnLimit = null,
  } = {},
) {
  const initialArtist = buildInitialArtist(mbid, artistNameFromNav);
  const selectedReleaseTypesKey = normalizeReleaseTypesSelection(
    selectedReleaseTypes,
  ).join("\0");
  const normalizedAppearsOnLimit = normalizePositiveLimit(appearsOnLimit);
  const appearsOnLimitKey = normalizedAppearsOnLimit
    ? String(normalizedAppearsOnLimit)
    : "";
  const visibleCoverIdsKey = Array.isArray(visibleCoverIds)
    ? visibleCoverIds.filter(Boolean).join("\0")
    : "";
  const initialLibraryExists = initialLibraryHint?.existsInLibrary;
  const initialLibraryArtist = initialLibraryHint?.libraryArtist || null;
  const stableInitialLibraryHint = useMemo(
    () => ({
      existsInLibrary: initialLibraryExists,
      libraryArtist: initialLibraryArtist,
    }),
    [initialLibraryExists, initialLibraryArtist],
  );
  const cachedLookupMap = mbid ? readLibraryLookupCache([mbid]) : {};
  const cachedLookup = cachedLookupMap?.[mbid];
  const seededExistsInLibrary =
    stableInitialLibraryHint.existsInLibrary === true || cachedLookup === true
      ? true
      : undefined;
  const seededLibraryArtist =
    seededExistsInLibrary && stableInitialLibraryHint.libraryArtist
      ? stableInitialLibraryHint.libraryArtist
      : null;

  const [artist, setArtist] = useState(initialArtist);
  const [coverImages, setCoverImages] = useState([]);
  const [libraryArtist, setLibraryArtist] = useState(seededLibraryArtist);
  const [libraryAlbums, setLibraryAlbums] = useState([]);
  const [similarArtists, setSimilarArtists] = useState([]);
  const [loading, setLoading] = useState(!mbid);
  const [error, setError] = useState(null);
  const [existsInLibrary, setExistsInLibrary] = useState(
    seededExistsInLibrary === true,
  );
  const [loadingCover, setLoadingCover] = useState(true);
  const [loadingSimilar, setLoadingSimilar] = useState(true);
  const [loadingLibrary, setLoadingLibrary] = useState(
    seededExistsInLibrary === undefined,
  );
  const [loadingReleases, setLoadingReleases] = useState(!!mbid);
  const [loadingAppearsOn, setLoadingAppearsOn] = useState(!!mbid);
  const [appSettings, setAppSettings] = useState(null);
  const [albumCovers, setAlbumCovers] = useState({});
  const requestedAlbumCoversRef = useRef(new Set());
  const artistMbidRef = useRef(mbid);
  const artistNameRef = useRef(artistNameFromNav || "");
  const selectedReleaseTypesRef = useRef(selectedReleaseTypes);
  const visibleCoverIdsRef = useRef(visibleCoverIds);
  const fetchedReleaseTypesRef = useRef(
    normalizeReleaseTypesSelection(selectedReleaseTypes),
  );
  const releaseRefreshRequestRef = useRef(0);
  const streamRequestRef = useRef(0);

  if (artistMbidRef.current !== mbid) {
    artistMbidRef.current = mbid;
    requestedAlbumCoversRef.current = new Set();
  }

  useEffect(() => {
    if (artistNameFromNav) artistNameRef.current = artistNameFromNav;
  }, [artistNameFromNav]);

  useEffect(() => {
    if (artist?.name) artistNameRef.current = artist.name;
  }, [artist?.name]);

  useEffect(() => {
    selectedReleaseTypesRef.current = selectedReleaseTypes;
  }, [selectedReleaseTypes, selectedReleaseTypesKey]);

  useEffect(() => {
    visibleCoverIdsRef.current = visibleCoverIds;
  }, [visibleCoverIds, visibleCoverIdsKey]);

  useEffect(() => {
    if (!mbid) return;
    const requestId = ++streamRequestRef.current;
    const isCurrentRequest = () => streamRequestRef.current === requestId;
    const nextCachedLookup = readLibraryLookupCache([mbid])?.[mbid];
    const nextSeededExistsInLibrary =
      stableInitialLibraryHint.existsInLibrary === true ||
      nextCachedLookup === true
        ? true
        : undefined;
    const nextSeededLibraryArtist =
      nextSeededExistsInLibrary && stableInitialLibraryHint.libraryArtist
        ? stableInitialLibraryHint.libraryArtist
        : null;
    setArtist(buildInitialArtist(mbid, artistNameFromNav));
    setCoverImages([]);
    setAlbumCovers({});
    setSimilarArtists([]);
    setLoading(!mbid);
    setError(null);
    setLoadingCover(true);
    setLoadingSimilar(true);
    setLoadingReleases(!!mbid);
    setLoadingAppearsOn(!!mbid);
    setLibraryArtist(nextSeededLibraryArtist);
    setLibraryAlbums([]);
    setExistsInLibrary(nextSeededExistsInLibrary === true);
    setLoadingLibrary(nextSeededExistsInLibrary === undefined);
    fetchedReleaseTypesRef.current = normalizeReleaseTypesSelection(
      selectedReleaseTypesRef.current,
    );
    releaseRefreshRequestRef.current += 1;

    getAppSettings()
      .then((settings) => {
        if (isCurrentRequest()) {
          setAppSettings(settings);
        }
      })
      .catch(() => {});

    const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
    const { token } = getStoredAuth();

    let streamUrl = `${API_BASE_URL}/artists/${mbid}/stream`;
    const streamParams = [];
    if (token) {
      streamParams.push(`token=${encodeURIComponent(token)}`);
    }
    if (artistNameFromNav) {
      streamParams.push(`artistName=${encodeURIComponent(artistNameFromNav)}`);
    }
    if (normalizedAppearsOnLimit) {
      streamParams.push(`appearsOnLimit=${encodeURIComponent(normalizedAppearsOnLimit)}`);
    }
    if (streamParams.length) streamUrl += `?${streamParams.join("&")}`;
    if (
      Array.isArray(selectedReleaseTypesRef.current) &&
      selectedReleaseTypesRef.current.length > 0
    ) {
      streamUrl += `${streamParams.length ? "&" : "?"}releaseTypes=${encodeURIComponent(
        selectedReleaseTypesRef.current.join(","),
      )}`;
    }

    const detailsMode = normalizedAppearsOnLimit ? "full" : "core";

    const eventSource = new EventSource(streamUrl);
    let artistReceived = false;
    let streamComplete = false;
    let coverReceived = false;
    let similarReceived = false;
    let libraryReceived = false;
    let restFallbackStarted = false;

    const loadCoverAndSimilarFallback = async (nameForCover, refreshCover = false) => {
      const requests = [];
      if (!coverReceived) {
        requests.push(
          getArtistCover(mbid, nameForCover, refreshCover)
            .then((coverData) => {
              if (!isCurrentRequest()) return;
              if (coverData.images && coverData.images.length > 0) {
                setCoverImages(coverData.images);
              }
            })
            .catch(() => {})
            .finally(() => {
              if (isCurrentRequest()) {
                setLoadingCover(false);
              }
            }),
        );
      }
      if (!similarReceived) {
        requests.push(
          getSimilarArtistsForArtist(mbid, nameForCover || "")
            .then((similarData) => {
              if (!isCurrentRequest()) return;
              setSimilarArtists(similarData.artists || []);
            })
            .catch(() => {})
            .finally(() => {
              if (isCurrentRequest()) {
                setLoadingSimilar(false);
              }
            }),
        );
      }
      await Promise.allSettled(requests);
    };

    const loadLibraryFallback = async () => {
      setLoadingLibrary(true);
      try {
        const lookup = await lookupArtistInLibrary(mbid);
        if (!isCurrentRequest()) return;
        setExistsInLibrary(lookup.exists);
        if (!lookup.exists || !lookup.artist) return;

        const fullArtist = await getLibraryArtist(
          lookup.artist.mbid || lookup.artist.foreignArtistId,
        ).catch((err) => {
          console.error("Failed to fetch full artist details:", err);
          return lookup.artist;
        });
        if (!isCurrentRequest()) return;

        setLibraryArtist(fullArtist);

        const artistId = fullArtist.id || lookup.artist.id;
        if (!artistId) return;

        const albums = await getLibraryAlbums(artistId).catch((err) => {
          console.error("Failed to fetch library albums:", err);
          return [];
        });
        if (!isCurrentRequest()) return;
        setLibraryAlbums(albums);
      } catch {}
      finally {
        if (isCurrentRequest()) {
          setLoadingLibrary(false);
        }
      }
    };

    const loadRestFallback = async () => {
      if (restFallbackStarted) return;
      restFallbackStarted = true;
      clearTimeout(fallbackTimeout);
      eventSource.close();

      try {
        const artistData = await getArtistDetails(mbid, artistNameFromNav, {
          mode: detailsMode,
          releaseTypes: selectedReleaseTypesRef.current,
          appearsOnLimit: normalizedAppearsOnLimit,
        });
        if (!artistData || !artistData.id) {
          throw new Error("Invalid artist data received");
        }
        if (!isCurrentRequest()) return;
        setArtist(artistData);
        setLoading(false);
        setLoadingReleases(false);
        setLoadingAppearsOn(false);

        const nameForCover = artistData?.name || artistNameRef.current || artistNameFromNav || "";
        artistNameRef.current = nameForCover;
        await Promise.allSettled([
          loadCoverAndSimilarFallback(nameForCover),
          libraryReceived ? Promise.resolve() : loadLibraryFallback(),
        ]);
      } catch (err) {
        console.error("Error fetching artist data:", err);
        if (!isCurrentRequest()) return;
        setError(
          err.response?.data?.message ||
            err.response?.data?.error ||
            err.message ||
            "Failed to fetch artist details",
        );
        setLoading(false);
        setLoadingCover(false);
        setLoadingSimilar(false);
        setLoadingLibrary(false);
        setLoadingReleases(false);
        setLoadingAppearsOn(false);
      }
    };

    const fallbackTimeout = setTimeout(() => {
      const nameForCover = artistNameRef.current || artistNameFromNav || "";
      loadCoverAndSimilarFallback(nameForCover).catch(() => {});
    }, 2500);

    eventSource.addEventListener("connected", () => {});

    eventSource.addEventListener("artist", (event) => {
      try {
        const artistData = JSON.parse(event.data);
        if (!isCurrentRequest()) return;
        if (!artistData) {
          throw new Error("Invalid artist data received");
        }
        if (!artistData.id && !artistReceived) {
          throw new Error("Invalid artist data received");
        }
        setArtist((prev) => {
          if (!prev) return artistData;
          const next = { ...prev, ...artistData };
          if (!("release-groups" in artistData)) {
            next["release-groups"] = prev["release-groups"];
          }
          if (!("appears-on-release-groups" in artistData)) {
            next["appears-on-release-groups"] = prev["appears-on-release-groups"];
          }
          if (!("release-group-count" in artistData)) {
            next["release-group-count"] = prev["release-group-count"];
          }
          if (!("release-count" in artistData)) {
            next["release-count"] = prev["release-count"];
          }
          if (!("tags" in artistData)) next.tags = prev.tags;
          if (!("genres" in artistData)) next.genres = prev.genres;
          if (!("bio" in artistData)) next.bio = prev.bio;
          return next;
        });
        if (
          "release-groups" in artistData &&
          Array.isArray(artistData["release-groups"])
        ) {
          setLoadingReleases(false);
        }
        if (
          "appears-on-release-groups" in artistData &&
          Array.isArray(artistData["appears-on-release-groups"])
        ) {
          setLoadingAppearsOn(false);
        }
        if (!artistReceived) setLoading(false);
        artistReceived = true;
      } catch (err) {
        console.error("Error parsing artist data:", err);
        if (!isCurrentRequest()) return;
        setError("Failed to parse artist data");
        setLoading(false);
      }
    });

    eventSource.addEventListener("cover", (event) => {
      try {
        const coverData = JSON.parse(event.data);
        if (!isCurrentRequest()) return;
        coverReceived = true;
        if (coverData.images && coverData.images.length > 0) {
          setCoverImages(coverData.images);
          setLoadingCover(false);
          return;
        }
        const nameForCover =
          artistNameRef.current || artistNameFromNav || "";
        if (nameForCover) {
          getArtistCover(mbid, nameForCover, true)
            .then((refreshedCover) => {
              if (!isCurrentRequest()) return;
              if (refreshedCover?.images?.length) {
                setCoverImages(refreshedCover.images);
              }
            })
            .catch(() => {})
            .finally(() => {
              if (isCurrentRequest()) {
                setLoadingCover(false);
              }
            });
          return;
        }
        setLoadingCover(false);
      } catch (err) {
        console.error("Error parsing cover data:", err, event.data);
        if (isCurrentRequest()) {
          setLoadingCover(false);
        }
      }
    });

    eventSource.addEventListener("similar", (event) => {
      try {
        const similarData = JSON.parse(event.data);
        if (!isCurrentRequest()) return;
        similarReceived = true;
        setSimilarArtists(similarData.artists || []);
        setLoadingSimilar(false);
      } catch (err) {
        console.error("Error parsing similar artists data:", err, event.data);
        if (isCurrentRequest()) {
          setLoadingSimilar(false);
        }
      }
    });

    eventSource.addEventListener("library", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!isCurrentRequest()) return;
        libraryReceived = true;
        if (data.exists && data.artist) {
          setExistsInLibrary(true);
          setLibraryArtist(data.artist);
          setLibraryAlbums(data.albums || []);
        } else if (!data.exists) {
          setExistsInLibrary(false);
          setLibraryArtist(null);
          setLibraryAlbums([]);
        }
        setLoadingLibrary(false);
      } catch (err) {
        console.error("Error parsing library data:", err, event.data);
      }
    });

    eventSource.addEventListener("complete", () => {
      if (!isCurrentRequest()) return;
      streamComplete = true;
      clearTimeout(fallbackTimeout);
      eventSource.close();
      setLoadingReleases(false);
      setLoadingAppearsOn(false);

      if (libraryReceived) {
        return;
      }

      loadLibraryFallback().catch(() => {});
    });

    eventSource.addEventListener("error", (event) => {
      try {
        const errorData = JSON.parse(event.data);
        if (!isCurrentRequest()) return;
        if (!artistReceived) {
          loadRestFallback().catch(() => {});
          return;
        }
        setError(
          errorData.message ||
            errorData.error ||
            "Failed to fetch artist details",
        );
        setLoading(false);
        eventSource.close();
      } catch {
        if (isCurrentRequest() && eventSource.readyState === EventSource.CLOSED) {
          loadRestFallback().catch(() => {});
        }
      }
    });

    eventSource.onerror = () => {
      if (isCurrentRequest() && !artistReceived && !streamComplete) {
        loadRestFallback().catch(() => {});
      }
    };

    return () => {
      clearTimeout(fallbackTimeout);
      eventSource.close();
    };
  }, [
    mbid,
    artistNameFromNav,
    stableInitialLibraryHint,
    appearsOnLimitKey,
    normalizedAppearsOnLimit,
  ]);

  useEffect(() => {
    if (!mbid || !artist?.id) return;

    const requestedReleaseTypes = normalizeReleaseTypesSelection(
      selectedReleaseTypesRef.current,
    );
    const fetchedReleaseTypes = fetchedReleaseTypesRef.current;

    if (
      requestedReleaseTypes.join(",") === fetchedReleaseTypes.join(",") ||
      isReleaseTypeSelectionCovered(requestedReleaseTypes, fetchedReleaseTypes)
    ) {
      return;
    }

    let cancelled = false;
    const requestId = ++releaseRefreshRequestRef.current;
    setLoadingReleases(true);

    getArtistDetails(
      mbid,
      artistNameRef.current || artist?.name || artistNameFromNav || "",
      {
        mode: normalizedAppearsOnLimit ? "full" : "core",
        releaseTypes: requestedReleaseTypes,
        appearsOnLimit: normalizedAppearsOnLimit,
      },
    )
      .then((artistData) => {
        if (
          cancelled ||
          requestId !== releaseRefreshRequestRef.current ||
          !artistData?.id
        ) {
          return;
        }
        fetchedReleaseTypesRef.current = requestedReleaseTypes;
        setArtist((prev) => {
          if (!prev) return artistData;
          return {
            ...prev,
            "release-groups": artistData["release-groups"] || [],
            "appears-on-release-groups":
              artistData["appears-on-release-groups"] ||
              prev["appears-on-release-groups"] ||
              [],
            "release-group-count":
              artistData["release-group-count"] ??
              prev["release-group-count"] ??
              0,
            "release-count":
              artistData["release-count"] ?? prev["release-count"] ?? 0,
          };
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled && requestId === releaseRefreshRequestRef.current) {
          setLoadingReleases(false);
        }
      });

    return () => {
      cancelled = true;
      if (requestId === releaseRefreshRequestRef.current) {
        setLoadingReleases(false);
      }
    };
  }, [
    mbid,
    artist?.id,
    artist?.name,
    artistNameFromNav,
    selectedReleaseTypesKey,
    appearsOnLimitKey,
    normalizedAppearsOnLimit,
  ]);

  useEffect(() => {
    if (!mbid) return;

    const nextVisibleCoverIds = Array.isArray(visibleCoverIdsRef.current)
      ? visibleCoverIdsRef.current.filter(Boolean)
      : [];
    if (!nextVisibleCoverIds.length) return;

    const missing = nextVisibleCoverIds.filter(
      (id) => !albumCovers[id] && !requestedAlbumCoversRef.current.has(id),
    );
    if (!missing.length) return;

    let cancelled = false;
    missing.forEach((id) => requestedAlbumCoversRef.current.add(id));

    const pageArtistName = artistNameRef.current || artist?.name || "";
    const items = missing.map((rgId) =>
      buildReleaseGroupCoverRequest(
        rgId,
        artist,
        libraryAlbums,
        pageArtistName,
      ),
    );

    getReleaseGroupCoversBatch(items)
      .then((covers) => {
        if (cancelled) return;
        const nextBatch = {};
        for (const rgId of missing) {
          const entry = covers?.[rgId];
          if (entry?.image) {
            nextBatch[rgId] = entry.image;
          }
        }
        if (Object.keys(nextBatch).length > 0) {
          setAlbumCovers((prev) => ({ ...prev, ...nextBatch }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          missing.forEach((id) => requestedAlbumCoversRef.current.delete(id));
        }
      });

    return () => {
      cancelled = true;
      missing.forEach((id) => requestedAlbumCoversRef.current.delete(id));
    };
  }, [mbid, visibleCoverIdsKey, artist, libraryAlbums, albumCovers]);

  return {
    artist,
    setArtist,
    coverImages,
    setCoverImages,
    libraryArtist,
    setLibraryArtist,
    libraryAlbums,
    setLibraryAlbums,
    similarArtists,
    setSimilarArtists,
    loading,
    error,
    setError,
    loadingCover,
    setLoadingCover,
    loadingSimilar,
    setLoadingSimilar,
    loadingLibrary,
    setLoadingLibrary,
    loadingReleases,
    loadingAppearsOn,
    existsInLibrary,
    setExistsInLibrary,
    appSettings,
    albumCovers,
    setAlbumCovers,
  };
}
