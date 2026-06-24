import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { downloadTracker } from "../../../services/weeklyFlow/weeklyFlowDownloadTracker.js";
import { weeklyFlowWorker } from "../../../services/weeklyFlow/weeklyFlowWorker.js";
import { noCache } from "../../../middleware/cache.js";
import { hasPermission, verifyTokenAuth } from "../../../middleware/auth.js";
import {
  resolveExistingWeeklyFlowTrackPath,
} from "../../../services/weeklyFlow/weeklyFlowPaths.js";
import {
  AUDIO_CONTENT_TYPES,
  canAccessPlaylistType,
} from "./utils.js";

export function registerStream(router) {
  router.get("/stream/:jobId", noCache, async (req, res) => {
    if (!verifyTokenAuth(req)) {
      return res
        .status(401)
        .json({ error: "Unauthorized", message: "Authentication required" });
    }
    if (req.user && !hasPermission(req.user, "accessFlow")) {
      return res
        .status(403)
        .json({ error: "Forbidden", message: "Permission required: accessFlow" });
    }
    const { jobId } = req.params;
    const job = downloadTracker.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: "Track not found" });
    }
    if (!canAccessPlaylistType(req.user, job.playlistType)) {
      return res.status(404).json({ error: "Track not found" });
    }
    if (job.status !== "done" || !job.finalPath) {
      return res.status(400).json({ error: "Track is not ready to stream" });
    }
    const resolved = await resolveExistingWeeklyFlowTrackPath(
      job.finalPath,
      weeklyFlowWorker.weeklyFlowRoot,
    );
    if (!resolved) {
      return res.status(404).json({ error: "Track file missing" });
    }
    if (resolved.migratedFrom) {
      downloadTracker.setDone(job.id, resolved.path, job.albumName || null);
    }
    const safePath = resolved.path;
    let stat;
    try {
      stat = await fsp.stat(safePath);
      if (!stat.isFile()) {
        return res.status(404).json({ error: "Track not found" });
      }
    } catch {
      return res.status(404).json({ error: "Track file missing" });
    }
    const ext = path.extname(safePath).toLowerCase();
    res.setHeader(
      "Content-Type",
      AUDIO_CONTENT_TYPES[ext] || "application/octet-stream",
    );
    res.setHeader("Accept-Ranges", "bytes");

    const range = req.headers.range;
    if (!range) {
      res.setHeader("Content-Length", stat.size);
      fs.createReadStream(safePath).pipe(res);
      return;
    }

    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      res.status(416).end();
      return;
    }
    const rawStart = match[1] ? Number(match[1]) : 0;
    const rawEnd = match[2] ? Number(match[2]) : stat.size - 1;
    const start = Number.isFinite(rawStart) ? rawStart : 0;
    const end = Number.isFinite(rawEnd) ? rawEnd : stat.size - 1;
    if (start < 0 || end < start || end >= stat.size) {
      res.status(416).end();
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", end - start + 1);
    fs.createReadStream(safePath, { start, end }).pipe(res);
  });
}
