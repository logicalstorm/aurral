import { useState, useEffect } from "react";
import {
  AudioWaveform,
  Sparkles,
  Music2,
  TrendingUp,
  Play,
  RotateCcw,
  Loader2,
  CheckCircle2,
  Clock,
} from "lucide-react";
import {
  getFlowStatus,
  startFlowPlaylist,
  resetFlowPlaylists,
  stopFlowWorker,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";

const PLAYLIST_CONFIG = [
  {
    id: "recommended",
    title: "Discover",
    description:
      "Recommendations from your library and scrobbles. Excludes artists already in your library.",
    icon: Sparkles,
    backendType: "recommended",
  },
  {
    id: "mix",
    title: "Mix",
    description:
      "Artists in your library with tracks you may not have yet. Great for filling gaps.",
    icon: Music2,
    backendType: "mix",
  },
  {
    id: "trending",
    title: "Trending",
    description: "Global trending artists and tracks from Last.fm charts.",
    icon: TrendingUp,
    backendType: "trending",
  },
];

const LIMIT_OPTIONS = [10, 20, 30];

function FlowPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(null);
  const [resetting, setResetting] = useState(null);
  const { showSuccess, showError } = useToast();

  const fetchStatus = async () => {
    try {
      const data = await getFlowStatus();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (!status?.worker?.running) return;
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [status?.worker?.running]);

  const getPlaylistStats = (backendType) => {
    if (!status?.jobs)
      return { total: 0, done: 0, failed: 0, pending: 0, downloading: 0 };
    const jobs = status.jobs.filter((j) => j.playlistType === backendType);
    return {
      total: jobs.length,
      done: jobs.filter((j) => j.status === "done").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      pending: jobs.filter((j) => j.status === "pending").length,
      downloading: jobs.filter((j) => j.status === "downloading").length,
    };
  };

  const getPlaylistState = (backendType) => {
    const stats = getPlaylistStats(backendType);
    if (stats.total === 0) return "idle";
    if (stats.downloading > 0 || stats.pending > 0) return "running";
    if (stats.done > 0 || stats.failed > 0) return "completed";
    return "idle";
  };

  const handleStart = async (backendType, limit = 30) => {
    setStarting(backendType);
    try {
      await startFlowPlaylist(backendType, limit);
      showSuccess(`Started ${backendType} (${limit} tracks)`);
      await fetchStatus();
    } catch (err) {
      showError(
        err.response?.data?.message || err.message || "Failed to start",
      );
    } finally {
      setStarting(null);
    }
  };

  const handleReset = async (playlistTypes) => {
    setResetting(true);
    try {
      await stopFlowWorker();
      await resetFlowPlaylists(playlistTypes);
      showSuccess("Reset complete");
      await fetchStatus();
    } catch (err) {
      showError(err.response?.data?.message || err.message || "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-[#707e61]" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 pb-12">
      <div className="flex items-center gap-3 mb-8">
        <AudioWaveform className="w-8 h-8 text-[#707e61]" />
        <div>
          <h1 className="text-2xl font-semibold text-white">Flow</h1>
          <p className="text-sm text-[#c1c1c3]">
            Weekly playlists built from Soulseek. Resets weekly or on demand.
          </p>
        </div>
      </div>

      {status?.worker && (
        <div className="mb-6 p-4 bg-card rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            {status.worker.running ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-[#707e61]" />
                <span className="text-white">
                  Worker {status.worker.processing ? "processing…" : "running"}
                </span>
              </>
            ) : (
              <>
                <Clock className="w-5 h-5 text-[#c1c1c3]" />
                <span className="text-[#c1c1c3]">Worker stopped</span>
              </>
            )}
          </div>
          {status.stats && (
            <span className="text-sm text-[#c1c1c3]">
              {status.stats.done} done · {status.stats.failed} failed ·{" "}
              {status.stats.pending} pending · {status.stats.downloading}{" "}
              downloading
            </span>
          )}
        </div>
      )}

      <div className="space-y-6">
        {PLAYLIST_CONFIG.map((config) => {
          const Icon = config.icon;
          const stats = getPlaylistStats(config.backendType);
          const state = getPlaylistState(config.backendType);
          const isStarting = starting === config.backendType;

          return (
            <div
              key={config.id}
              className="p-6 bg-card rounded-lg border border-white/5"
            >
              <div className="flex items-start gap-4">
                <div className="p-2 rounded-lg bg-white/5">
                  <Icon className="w-6 h-6 text-[#707e61]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-medium text-white">
                    {config.title}
                  </h2>
                  <p className="text-sm text-[#c1c1c3] mt-1">
                    {config.description}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {state === "running" && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-[#707e61]">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {stats.done + stats.failed}/{stats.total} tracks
                      </span>
                    )}
                    {state === "completed" && stats.total > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-[#707e61]">
                        <CheckCircle2 className="w-4 h-4" />
                        {stats.done} done
                        {stats.failed > 0 && ` · ${stats.failed} failed`}
                      </span>
                    )}
                    {state === "idle" && (
                      <span className="text-sm text-[#c1c1c3]">
                        Not running · Resets weekly
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {LIMIT_OPTIONS.map((limit) => (
                      <button
                        key={limit}
                        onClick={() => handleStart(config.backendType, limit)}
                        disabled={isStarting || state === "running"}
                        className="px-3 py-1.5 text-sm font-medium rounded bg-[#707e61]/20 text-[#707e61] hover:bg-[#707e61]/30 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isStarting ? (
                          <Loader2 className="w-4 h-4 animate-spin inline" />
                        ) : (
                          <Play className="w-4 h-4 inline mr-1 -mt-0.5" />
                        )}{" "}
                        Start {limit}
                      </button>
                    ))}
                    <button
                      onClick={() => handleReset([config.backendType])}
                      disabled={resetting || state === "idle"}
                      className="px-3 py-1.5 text-sm font-medium rounded bg-white/10 text-[#c1c1c3] hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                    >
                      {resetting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4" />
                      )}{" "}
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 p-4 bg-white/5 rounded-lg border border-white/5">
        <p className="text-sm text-[#c1c1c3]">
          <strong className="text-white">Coming later:</strong> Pin playlists
          from Discover (“because you like X”) and tag searches to build custom
          Flow playlists by genre and tags.
        </p>
      </div>
    </div>
  );
}

export default FlowPage;
