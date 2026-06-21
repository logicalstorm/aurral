import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getRustWorkerBinaryPath,
  getLastfmNetworkConcurrency,
} from "./discoveryWorkerConfig.js";
import { getLastfmApiKey } from "./apiClients.js";
import { withWorkerPerfSpan } from "./workerPerfMetrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_BINARY_CANDIDATES = [
  path.join(__dirname, "..", "native", "aurral-worker", "target", "release", "aurral-worker"),
  path.join(__dirname, "..", "native", "aurral-worker", "target", "debug", "aurral-worker"),
  path.join(process.cwd(), "backend", "native", "aurral-worker", "target", "release", "aurral-worker"),
  path.join(process.cwd(), "usr", "local", "bin", "aurral-worker"),
  "/usr/local/bin/aurral-worker",
];

let resolvedBinaryPath = null;
let daemonProcess = null;
let daemonReady = null;
let daemonBuffer = "";
const daemonPending = new Map();
let daemonRequestCounter = 0;

export function resolveRustWorkerBinary() {
  if (resolvedBinaryPath) return resolvedBinaryPath;
  const configured = getRustWorkerBinaryPath();
  if (configured && fs.existsSync(configured)) {
    resolvedBinaryPath = configured;
    return resolvedBinaryPath;
  }
  for (const candidate of DEFAULT_BINARY_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      resolvedBinaryPath = candidate;
      return resolvedBinaryPath;
    }
  }
  return null;
}

export function getRustWorkerStatus() {
  const binaryPath = resolveRustWorkerBinary();
  const lastfmConfigured = Boolean(getLastfmApiKey());
  return {
    available: Boolean(binaryPath) && lastfmConfigured,
    path: binaryPath,
    required: lastfmConfigured,
    daemonRunning: Boolean(daemonProcess && !daemonProcess.killed),
    jobs: ["discovery-refresh", "discovery-run", "discovery-pipeline", "discovery-prep", "playlist-plan", "flow-plan"],
  };
}

export function isRustWorkerAvailable() {
  return getRustWorkerStatus().available;
}

const buildRustWorkerEnv = async () => {
  const apiKey = getLastfmApiKey();
  const { getMetadataBaseUrl } = await import("./providers/brainzmashProvider.js");
  return {
    ...process.env,
    ...(apiKey ? { LASTFM_API_KEY: apiKey } : {}),
    AURRAL_LASTFM_CONCURRENCY: String(getLastfmNetworkConcurrency()),
    AURRAL_METADATA_BASE_URL: getMetadataBaseUrl(),
  };
};

const rejectAllPending = (error) => {
  for (const [id, entry] of daemonPending.entries()) {
    clearTimeout(entry.timer);
    daemonPending.delete(id);
    if (!entry.jobType) {
      entry.reject(error || new Error("aurral-worker daemon connection closed"));
      continue;
    }
    runRustWorkerProcess(entry.jobType, entry.payload, entry.timeoutMs)
      .then(entry.resolve)
      .catch((fallbackError) => {
        entry.reject(
          fallbackError ||
            error ||
            new Error("aurral-worker daemon connection closed"),
        );
      });
  }
};

const resetDaemonProcess = (error = null) => {
  if (error) {
    rejectAllPending(error);
  }
  const child = daemonProcess;
  daemonProcess = null;
  daemonReady = null;
  daemonBuffer = "";
  if (!child || child.killed) return;
  try {
    child.stdin?.destroy();
  } catch {}
  try {
    child.kill("SIGTERM");
  } catch {}
};

const isBrokenPipeError = (error) =>
  error?.code === "EPIPE" ||
  error?.code === "ERR_STREAM_DESTROYED" ||
  /EPIPE/i.test(String(error?.message || ""));

const writeDaemonRequest = (child, request) =>
  new Promise((resolve, reject) => {
    const stdin = child?.stdin;
    if (!stdin || stdin.destroyed) {
      reject(new Error("aurral-worker daemon stdin is not writable"));
      return;
    }
    const onError = (error) => {
      stdin.off("error", onError);
      reject(error);
    };
    stdin.once("error", onError);
    stdin.write(request, (error) => {
      stdin.off("error", onError);
      if (error) reject(error);
      else resolve();
    });
  });

const handleDaemonLine = (line) => {
  const trimmed = String(line || "").trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }
  const id = String(parsed?.id || "").trim();
  if (!id || !daemonPending.has(id)) return;
  const entry = daemonPending.get(id);
  daemonPending.delete(id);
  clearTimeout(entry.timer);
  if (parsed?.ok === false) {
    entry.reject(new Error(parsed?.error || "aurral-worker daemon job failed"));
    return;
  }
  entry.resolve({
    ok: true,
    result: parsed?.result || {},
    stats: parsed?.stats || null,
  });
};

const ensureDaemonProcess = async () => {
  if (daemonProcess && !daemonProcess.killed) {
    return daemonProcess;
  }
  if (daemonReady) {
    await daemonReady;
    return daemonProcess;
  }

  const binaryPath = resolveRustWorkerBinary();
  if (!binaryPath) {
    throw new Error("aurral-worker binary not found");
  }
  if (!getLastfmApiKey()) {
    throw new Error("Last.fm API key is not configured");
  }

  daemonReady = new Promise((resolve, reject) => {
    buildRustWorkerEnv()
      .then((env) => {
        const child = spawn(binaryPath, ["daemon"], {
          stdio: ["pipe", "pipe", "pipe"],
          env,
        });
        daemonProcess = child;
        daemonBuffer = "";

        child.stdout.on("data", (chunk) => {
          daemonBuffer += String(chunk || "");
          let newlineIndex = daemonBuffer.indexOf("\n");
          while (newlineIndex >= 0) {
            const line = daemonBuffer.slice(0, newlineIndex);
            daemonBuffer = daemonBuffer.slice(newlineIndex + 1);
            handleDaemonLine(line);
            newlineIndex = daemonBuffer.indexOf("\n");
          }
        });

        child.stderr.on("data", (chunk) => {
          const message = String(chunk || "").trim();
          if (message) {
            console.warn(`[rustWorker] ${message}`);
          }
        });

        child.stdin.on("error", (error) => {
          if (!isBrokenPipeError(error)) {
            console.warn(`[rustWorker] daemon stdin error: ${error.message}`);
          }
          resetDaemonProcess(
            new Error(`aurral-worker daemon stdin closed: ${error.message}`),
          );
        });

        child.on("error", (error) => {
          resetDaemonProcess(error);
          reject(error);
        });

        child.on("close", (code) => {
          resetDaemonProcess(
            new Error(`aurral-worker daemon exited ${code ?? "unknown"}`),
          );
        });

        resolve(child);
      })
      .catch(reject);
  });

  await daemonReady;
  return daemonProcess;
};

const runRustWorkerDaemonJob = (jobType, payload, timeoutMs) =>
  new Promise(async (resolve, reject) => {
    try {
      const child = await ensureDaemonProcess();
      const id = `${Date.now()}-${++daemonRequestCounter}`;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (!daemonPending.has(id)) return;
              daemonPending.delete(id);
              reject(
                new Error(
                  `aurral-worker ${jobType} timed out after ${timeoutMs}ms`,
                ),
              );
            }, timeoutMs)
          : null;

      daemonPending.set(id, {
        resolve,
        reject,
        timer,
        jobType,
        payload,
        timeoutMs,
      });
      const request = `${JSON.stringify({ id, job: jobType, payload })}\n`;
      try {
        await writeDaemonRequest(child, request);
      } catch (error) {
        if (timer) clearTimeout(timer);
        daemonPending.delete(id);
        if (isBrokenPipeError(error)) {
          resetDaemonProcess(error);
          try {
            const value = await runRustWorkerProcess(jobType, payload, timeoutMs);
            resolve(value);
            return;
          } catch (fallbackError) {
            reject(fallbackError);
            return;
          }
        }
        reject(error);
      }
    } catch (error) {
      reject(error);
    }
  });

const runRustWorkerProcess = (jobType, payload, timeoutMs) =>
  new Promise((resolve, reject) => {
    const binaryPath = resolveRustWorkerBinary();
    if (!binaryPath) {
      reject(new Error("aurral-worker binary not found"));
      return;
    }
    if (!getLastfmApiKey()) {
      reject(new Error("Last.fm API key is not configured"));
      return;
    }

    buildRustWorkerEnv()
      .then((env) => {
        const child = spawn(binaryPath, [jobType], {
          stdio: ["pipe", "pipe", "pipe"],
          env,
        });

        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(value);
        };

        const timer =
          timeoutMs > 0
            ? setTimeout(() => {
                child.kill("SIGTERM");
                finish(
                  new Error(
                    `aurral-worker ${jobType} timed out after ${timeoutMs}ms`,
                  ),
                );
              }, timeoutMs)
            : null;

        child.stdout.on("data", (chunk) => {
          stdout += String(chunk || "");
        });
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk || "");
        });
        child.on("error", (error) => finish(error));
        child.on("close", (code) => {
          if (code !== 0) {
            finish(
              new Error(
                `aurral-worker ${jobType} exited ${code}: ${stderr.trim() || stdout.trim() || "unknown error"}`,
              ),
            );
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim() || "{}");
            if (parsed?.ok === false) {
              finish(new Error(parsed?.error || `aurral-worker ${jobType} failed`));
              return;
            }
            finish(null, parsed);
          } catch (error) {
            finish(
              new Error(
                `aurral-worker ${jobType} returned invalid JSON: ${error.message}`,
              ),
            );
          }
        });

        child.stdin.on("error", (error) => {
          if (!settled && !isBrokenPipeError(error)) {
            finish(error);
          }
        });

        child.stdin.write(JSON.stringify(payload), (error) => {
          if (error && !settled) {
            finish(error);
            return;
          }
          child.stdin.end();
        });
      })
      .catch(reject);
  });

export async function runRustWorkerJob(jobType, payload, options = {}) {
  const timeoutMs = Math.max(
    0,
    Number(options.timeoutMs) || 45 * 60 * 1000,
  );
  const useDaemon = options.useDaemon !== false;
  return withWorkerPerfSpan(
    `rust-worker:${jobType}`,
    () =>
      useDaemon
        ? runRustWorkerDaemonJob(jobType, payload, timeoutMs)
        : runRustWorkerProcess(jobType, payload, timeoutMs),
    payload?.discoveryRunId || payload?.cacheNamespace || null,
  );
}

export async function runRustDiscoveryRefresh(payload) {
  return runRustWorkerJob("discovery-refresh", payload);
}

export async function runRustDiscoveryRun(payload) {
  return runRustWorkerJob("discovery-run", payload);
}

export async function runRustDiscoveryPipeline(payload) {
  return runRustWorkerJob("discovery-pipeline", payload, { useDaemon: false });
}

export async function runRustDiscoveryPrep(payload) {
  return runRustWorkerJob("discovery-prep", payload, { useDaemon: false });
}

export async function runRustFlowPlan(payload) {
  return runRustWorkerJob("flow-plan", payload);
}

export async function runRustPlaylistPlan(payload) {
  return runRustWorkerJob("playlist-plan", payload, { useDaemon: false });
}

export function shutdownRustWorkerDaemon() {
  resetDaemonProcess(new Error("aurral-worker daemon shutting down"));
}
