import { useState, useEffect } from "react";
import {
  AudioWaveform,
  Sparkles,
  Music2,
  TrendingUp,
  Loader2,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { getFlowStatus, setFlowPlaylistEnabled } from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import PowerSwitch from "../components/PowerSwitch";

const PLAYLIST_CONFIG = [
  {
    id: "discover",
    title: "Discover",
    description:
      "Recommendations from your library and scrobbles. Excludes artists already in your library.",
    icon: Sparkles,
    backendType: "discover",
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

function formatNextRun(nextRunAt) {
  if (!nextRunAt) return null;
  const ts =
    typeof nextRunAt === "number" ? nextRunAt : parseInt(nextRunAt, 10);
  if (!Number.isFinite(ts)) return null;
  const now = Date.now();
  const diff = ts - now;
  if (diff <= 0) return "Refreshing soon";
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return days === 1 ? "Resets tomorrow" : `Resets in ${days} days`;
}

function FlowPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(null);
  const [optimisticEnabled, setOptimisticEnabled] = useState({});
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

  const isEnabled = (backendType) =>
    status?.playlists?.[backendType]?.enabled === true;

  const handleToggle = async (backendType, enabled) => {
    setOptimisticEnabled((prev) => ({ ...prev, [backendType]: enabled }));
    setToggling(backendType);
    try {
      await setFlowPlaylistEnabled(backendType, enabled);
      showSuccess(
        enabled ? `${backendType} playlist on` : `${backendType} playlist off`,
      );
      await fetchStatus();
    } catch (err) {
      setOptimisticEnabled((prev) => {
        const next = { ...prev };
        delete next[backendType];
        return next;
      });
      showError(
        err.response?.data?.message || err.message || "Failed to update",
      );
    } finally {
      setToggling(null);
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
            Weekly playlists. Turn on to run in the background; resets every
            week.
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

      <div className="space-y-4">
        {PLAYLIST_CONFIG.map((config) => {
          const Icon = config.icon;
          const stats = getPlaylistStats(config.backendType);
          const state = getPlaylistState(config.backendType);
          const enabled =
            optimisticEnabled[config.backendType] ??
            isEnabled(config.backendType);
          const nextRun = formatNextRun(
            status?.playlists?.[config.backendType]?.nextRunAt,
          );
          const isToggling = toggling === config.backendType;

          return (
            <div
              key={config.id}
              className="p-5 bg-card rounded-lg border border-white/5 overflow-hidden"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="p-2 rounded-lg bg-white/5 flex-shrink-0">
                    <Icon className="w-5 h-5 text-[#707e61]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-medium text-white">
                        {config.title}
                      </h2>
                      {isToggling && (
                        <Loader2 className="w-4 h-4 animate-spin text-[#707e61] flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-[#c1c1c3] mt-0.5">
                      {config.description}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-sm text-[#c1c1c3]">
                      {state === "running" && (
                        <span className="inline-flex items-center gap-1.5 text-[#707e61]">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {stats.done + stats.failed}/{stats.total}
                        </span>
                      )}
                      {state === "completed" && stats.total > 0 && (
                        <span className="inline-flex items-center gap-1.5 text-[#707e61]">
                          <CheckCircle2 className="w-4 h-4" />
                          {stats.done} done
                          {stats.failed > 0 && ` · ${stats.failed} failed`}
                        </span>
                      )}
                      {enabled && nextRun && <span>{nextRun}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <PowerSwitch
                    checked={enabled}
                    onChange={(e) =>
                      handleToggle(config.backendType, e.target.checked)
                    }
                  />
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
