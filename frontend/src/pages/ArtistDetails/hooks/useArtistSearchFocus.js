import { useEffect, useRef, useState } from "react";

function findReleaseGroup(artist, releaseGroupMbid) {
  if (!artist || !releaseGroupMbid) {
    return { releaseGroup: null, section: null };
  }
  const main = (artist["release-groups"] || []).find(
    (rg) => rg.id === releaseGroupMbid,
  );
  if (main) return { releaseGroup: main, section: "albums" };
  const appearsOn = (artist["appears-on-release-groups"] || []).find(
    (rg) => rg.id === releaseGroupMbid,
  );
  if (appearsOn) return { releaseGroup: appearsOn, section: "appears-on" };
  return { releaseGroup: null, section: null };
}

function buildPreservedState(locationState, focusReleaseGroupMbid, focusTrackMbid) {
  return {
    artistName: locationState?.artistName,
    inLibrary: locationState?.inLibrary,
    libraryArtist: locationState?.libraryArtist,
    focusReleaseGroupMbid,
    focusTrackMbid,
  };
}

export function useArtistSearchFocus({
  artist,
  loading,
  loadingReleases,
  library,
  libraryAlbums = [],
  navigate,
  mbid,
  locationState,
  pageContext,
  prepareForFocus,
}) {
  const focusReleaseGroupMbid = locationState?.focusReleaseGroupMbid || null;
  const focusTrackMbid = locationState?.focusTrackMbid || null;
  const [highlightTrackId, setHighlightTrackId] = useState(null);
  const appliedRef = useRef(false);

  useEffect(() => {
    appliedRef.current = false;
    setHighlightTrackId(null);
  }, [mbid, focusReleaseGroupMbid, focusTrackMbid]);

  useEffect(() => {
    if (appliedRef.current || !focusReleaseGroupMbid) return;
    if (loading || !artist) return;

    const { releaseGroup, section } = findReleaseGroup(
      artist,
      focusReleaseGroupMbid,
    );

    if (loadingReleases && !releaseGroup) return;

    if (!releaseGroup) {
      const libAlbum = libraryAlbums.find(
        (album) =>
          album.mbid === focusReleaseGroupMbid ||
          album.foreignAlbumId === focusReleaseGroupMbid,
      );
      if (libAlbum && pageContext === "artist") {
        library.handleLibraryAlbumClick(focusReleaseGroupMbid, libAlbum.id);
        appliedRef.current = true;
        if (focusTrackMbid) setHighlightTrackId(focusTrackMbid);
      }
      return;
    }

    const preservedState = buildPreservedState(
      locationState,
      focusReleaseGroupMbid,
      focusTrackMbid,
    );

    if (section === "appears-on" && pageContext !== "appears-on") {
      navigate(`/artist/${mbid}/appears-on`, {
        state: preservedState,
        replace: true,
      });
      return;
    }

    if (section === "albums" && pageContext === "artist") {
      navigate(`/artist/${mbid}/albums`, {
        state: preservedState,
        replace: true,
      });
      return;
    }

    if (pageContext === "albums" && section === "appears-on") {
      navigate(`/artist/${mbid}/appears-on`, {
        state: preservedState,
        replace: true,
      });
      return;
    }

    if (prepareForFocus && !prepareForFocus(releaseGroup)) {
      return;
    }

    const status = library.getAlbumStatus(releaseGroup.id);
    library.handleReleaseGroupAlbumClick(releaseGroup, status?.libraryId);
    appliedRef.current = true;
    if (focusTrackMbid) {
      setHighlightTrackId(focusTrackMbid);
    }
  }, [
    artist,
    focusReleaseGroupMbid,
    focusTrackMbid,
    loading,
    loadingReleases,
    library,
    libraryAlbums,
    locationState,
    mbid,
    navigate,
    pageContext,
    prepareForFocus,
  ]);

  return { highlightTrackId, focusReleaseGroupMbid };
}
