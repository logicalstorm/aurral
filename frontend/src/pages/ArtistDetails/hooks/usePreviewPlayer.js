import { useState, useEffect, useRef, useCallback } from "react";
import { useSharedVolume } from "../../../hooks/useSharedVolume";
import { getArtistPreview } from "../../../utils/api";

const SNAP_BACK_MS = 320;

export function usePreviewPlayer(mbid, artistNameFromNav, artist) {
  const [previewTracks, setPreviewTracks] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [playingPreviewId, setPlayingPreviewId] = useState(null);
  const [previewSnappingBack, setPreviewSnappingBack] = useState(false);
  const [previewPaused, setPreviewPaused] = useState(false);
  const [previewAnimationKey, setPreviewAnimationKey] = useState(0);
  const [playAllActive, setPlayAllActive] = useState(false);
  const [previewVolume, setPreviewVolume] = useSharedVolume();
  const previewAudioRef = useRef(null);
  const snapBackTimeoutRef = useRef(null);
  const playAllActiveRef = useRef(false);
  const previewTracksRef = useRef([]);
  const playingPreviewIdRef = useRef(null);
  const advancePlayAllRef = useRef(null);

  useEffect(() => {
    previewTracksRef.current = previewTracks;
  }, [previewTracks]);

  useEffect(() => {
    playingPreviewIdRef.current = playingPreviewId;
  }, [playingPreviewId]);

  useEffect(() => {
    playAllActiveRef.current = playAllActive;
  }, [playAllActive]);

  useEffect(() => {
    const name = artistNameFromNav || artist?.name;
    if (!mbid || !name) {
      if (!artistNameFromNav && !artist) setPreviewTracks([]);
      return;
    }
    setLoadingPreview(true);
    getArtistPreview(mbid, name)
      .then((data) => setPreviewTracks(data.tracks || []))
      .catch(() => setPreviewTracks([]))
      .finally(() => setLoadingPreview(false));
  }, [mbid, artistNameFromNav, artist]);

  const finishSnapBack = useCallback(() => {
    if (snapBackTimeoutRef.current) clearTimeout(snapBackTimeoutRef.current);
    snapBackTimeoutRef.current = null;
    setPlayingPreviewId(null);
    setPreviewSnappingBack(false);
    setPreviewPaused(false);
    setPlayAllActive(false);
  }, []);

  const scheduleSnapBack = useCallback(() => {
    setPreviewSnappingBack(true);
    setPreviewPaused(false);
    if (snapBackTimeoutRef.current) clearTimeout(snapBackTimeoutRef.current);
    snapBackTimeoutRef.current = setTimeout(finishSnapBack, SNAP_BACK_MS);
  }, [finishSnapBack]);

  const getPlayableTracks = useCallback(
    () => previewTracksRef.current.filter((track) => track?.preview_url),
    [],
  );

  const playPreviewTrack = useCallback(
    (track) => {
      const audio = previewAudioRef.current;
      if (!audio || !track?.preview_url) return;
      if (snapBackTimeoutRef.current) clearTimeout(snapBackTimeoutRef.current);
      snapBackTimeoutRef.current = null;
      setPreviewSnappingBack(false);
      setPreviewPaused(false);
      setPreviewAnimationKey((key) => key + 1);
      setPlayingPreviewId(track.id);
      audio.volume = previewVolume;
      audio.src = track.preview_url;
      audio.play();
    },
    [previewVolume],
  );

  const advancePlayAll = useCallback(() => {
    const playable = getPlayableTracks();
    const currentId = playingPreviewIdRef.current;
    const currentIndex = playable.findIndex((track) => track.id === currentId);
    const nextTrack = currentIndex >= 0 ? playable[currentIndex + 1] : null;
    if (nextTrack) {
      playPreviewTrack(nextTrack);
      return;
    }
    setPlayAllActive(false);
    scheduleSnapBack();
  }, [getPlayableTracks, playPreviewTrack, scheduleSnapBack]);

  advancePlayAllRef.current = advancePlayAll;

  const handlePreviewPlay = (track) => {
    const audio = previewAudioRef.current;
    if (!audio || !track.preview_url) return;
    setPlayAllActive(false);
    audio.volume = previewVolume;
    if (playingPreviewId === track.id) {
      if (audio.paused) {
        if (snapBackTimeoutRef.current)
          clearTimeout(snapBackTimeoutRef.current);
        snapBackTimeoutRef.current = null;
        setPreviewSnappingBack(false);
        setPreviewPaused(false);
        audio.play();
      } else {
        audio.pause();
        scheduleSnapBack();
      }
      return;
    }
    playPreviewTrack(track);
  };

  const handlePreviewPlayAll = () => {
    const audio = previewAudioRef.current;
    const playable = getPlayableTracks();
    if (!audio || playable.length === 0) return;

    if (playAllActive && playingPreviewId) {
      if (!audio.paused && !previewSnappingBack) {
        audio.pause();
        setPreviewPaused(true);
        return;
      }
      if (audio.paused) {
        if (snapBackTimeoutRef.current)
          clearTimeout(snapBackTimeoutRef.current);
        snapBackTimeoutRef.current = null;
        setPreviewSnappingBack(false);
        setPreviewPaused(false);
        audio.play();
        return;
      }
    }

    setPlayAllActive(true);
    playPreviewTrack(playable[0]);
  };

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    audio.volume = previewVolume;
  }, [previewTracks.length, previewVolume]);

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (playAllActiveRef.current) {
        advancePlayAllRef.current?.();
        return;
      }
      scheduleSnapBack();
    };
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("ended", onEnded);
    };
  }, [previewTracks.length, scheduleSnapBack]);

  return {
    previewTracks,
    setPreviewTracks,
    loadingPreview,
    setLoadingPreview,
    playingPreviewId,
    previewSnappingBack,
    previewPaused,
    previewAnimationKey,
    playAllActive,
    previewVolume,
    setPreviewVolume,
    previewAudioRef,
    handlePreviewPlay,
    handlePreviewPlayAll,
  };
}
