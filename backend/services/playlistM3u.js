import fs from "fs/promises";
import path from "path";
import {
  flowPlaylistConfig,
  tracksShareMembership,
} from "./weeklyFlow/weeklyFlowPlaylistConfig.js";
import { downloadTracker } from "./weeklyFlow/weeklyFlowDownloadTracker.js";
import {
  remapLegacyPath as remapLegacyWeeklyFlowPath,
  resolvePlaylistRoot as resolveWeeklyFlowRoot,
} from "./playlistPaths.js";import { getM3uPathMode, normalizeM3uPathMode, resolveM3uTrackPath } from "./playlistM3uPaths.js";

export function formatExtinf(durationSeconds, title, artist) {
  const duration = Math.max(0, Math.floor(Number(durationSeconds) || 0));
  const label = artist && title ? `${artist} - ${title}` : title || artist || "";
  return `#EXTINF:${duration},${label}`;
}

export function buildM3uContent(entries) {
  const lines = ["#EXTM3U"];
  for (const entry of entries) {
    if (!entry?.path) continue;
    const normalizedPath = String(entry.path).replace(/\\/g, "/");
    lines.push(formatExtinf(entry.durationSeconds, entry.title, entry.artist));
    lines.push(normalizedPath);
  }
  return `${lines.join("\n")}\n`;
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function sortJobsByCreatedAt(jobs) {
  return [...jobs].sort((left, right) => {
    const leftCreated = Number(left?.createdAt || 0);
    const rightCreated = Number(right?.createdAt || 0);
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  });
}

function jobToEntry(job, weeklyFlowRoot, m3uPathMode = getM3uPathMode()) {
  const localPath = path.resolve(remapLegacyWeeklyFlowPath(job.finalPath, weeklyFlowRoot));
  return {
    path: resolveM3uTrackPath(job, localPath, m3uPathMode),
    title: job.trackName || null,
    artist: job.artistName || null,
    durationSeconds: job.durationMs ? Math.round(job.durationMs / 1000) : 0,
  };
}

export async function collectPlaylistM3uEntries(playlistType, options = {}) {
  const weeklyFlowRoot = path.resolve(options.weeklyFlowRoot || resolveWeeklyFlowRoot());
  const m3uPathMode = normalizeM3uPathMode(options.m3uPathMode ?? getM3uPathMode());
  const doneJobs = sortJobsByCreatedAt(
    downloadTracker
      .getByPlaylistType(playlistType)
      .filter((job) => job?.status === "done" && typeof job?.finalPath === "string"),
  );

  const sharedPlaylist = flowPlaylistConfig.getSharedPlaylist(playlistType);
  let orderedJobs;
  if (sharedPlaylist?.tracks?.length) {
    orderedJobs = [];
    const remaining = [...doneJobs];
    for (const track of sharedPlaylist.tracks) {
      const index = remaining.findIndex((job) => tracksShareMembership(track, job));
      if (index >= 0) orderedJobs.push(remaining.splice(index, 1)[0]);
    }
  } else {
    orderedJobs = doneJobs;
  }

  const entries = [];
  for (const job of orderedJobs) {
    const localPath = path.resolve(remapLegacyWeeklyFlowPath(job.finalPath, weeklyFlowRoot));
    if (!(await fileExists(localPath))) continue;
    entries.push(jobToEntry(job, weeklyFlowRoot, m3uPathMode));
  }
  return entries;
}
