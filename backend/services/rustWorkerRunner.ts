import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRustWorkerBinaryPath, getLastfmNetworkConcurrency } from './discoveryWorkerConfig.js';
import { getLastfmApiKey } from './apiClients.js';
import { withWorkerPerfSpan } from './workerPerfMetrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_BINARY_CANDIDATES: string[] = [
  path.join(__dirname, '..', 'native', 'aurral-worker', 'target', 'release', 'aurral-worker'),
  path.join(__dirname, '..', 'native', 'aurral-worker', 'target', 'debug', 'aurral-worker'),
  path.join(
    process.cwd(),
    'backend',
    'native',
    'aurral-worker',
    'target',
    'release',
    'aurral-worker',
  ),
  path.join(process.cwd(), 'usr', 'local', 'bin', 'aurral-worker'),
  '/usr/local/bin/aurral-worker',
];

let resolvedBinaryPath: string | null = null;
let daemonProcess: ChildProcess | null = null;
let daemonReady: Promise<ChildProcess> | null = null;
let daemonBuffer = '';
interface DaemonPendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  jobType?: string;
  payload?: Record<string, unknown>;
  timeoutMs?: number;
}
const daemonPending = new Map<string, DaemonPendingEntry>();
let daemonRequestCounter = 0;

export function resolveRustWorkerBinary(): string | null {
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

export function getRustWorkerStatus(): { available: boolean; path: string | null; required: boolean; daemonRunning: boolean; jobs: string[] } {
  const binaryPath = resolveRustWorkerBinary();
  const lastfmConfigured = Boolean(getLastfmApiKey());
  return {
    available: Boolean(binaryPath) && lastfmConfigured,
    path: binaryPath,
    required: lastfmConfigured,
    daemonRunning: Boolean(daemonProcess && !daemonProcess.killed),
    jobs: [
      'discovery-refresh',
      'discovery-run',
      'discovery-pipeline',
      'discovery-prep',
      'slskd-matcher',
      'playlist-plan',
      'flow-plan',
    ],
  };
}

export function isRustWorkerAvailable(): boolean {
  return getRustWorkerStatus().available;
}

const buildRustWorkerEnv = async (): Promise<Record<string, string | undefined>> => {
  const apiKey = getLastfmApiKey();
  const { getMetadataBaseUrl } = await import('./providers/brainzmashProvider.js');
  return {
    ...process.env,
    ...(apiKey ? { LASTFM_API_KEY: apiKey } : {}),
    AURRAL_LASTFM_CONCURRENCY: String(getLastfmNetworkConcurrency()),
    AURRAL_METADATA_BASE_URL: getMetadataBaseUrl(),
  };
};

const rejectAllPending = (error: Error | null): void => {
  for (const [id, entry] of daemonPending.entries()) {
    if (entry.timer) clearTimeout(entry.timer);
    daemonPending.delete(id);
    if (!entry.jobType) {
      entry.reject(error || new Error('aurral-worker daemon connection closed'));
      continue;
    }
    runRustWorkerProcess(entry.jobType, entry.payload!, entry.timeoutMs!)
      .then(entry.resolve)
      .catch((fallbackError: unknown) => {
        entry.reject(fallbackError || error || new Error('aurral-worker daemon connection closed'));
      });
  }
};

const resetDaemonProcess = (error: Error | null = null): void => {
  if (error) {
    rejectAllPending(error);
  }
  const child = daemonProcess;
  daemonProcess = null;
  daemonReady = null;
  daemonBuffer = '';
  if (!child || child.killed) return;
  try {
    child.stdin?.destroy();
  } catch {}
  try {
    child.kill('SIGTERM');
  } catch {}
};

const isBrokenPipeError = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException)?.code === 'EPIPE' ||
  (error as NodeJS.ErrnoException)?.code === 'ERR_STREAM_DESTROYED' ||
  /EPIPE/i.test(String((error as Error)?.message || ''));

const writeDaemonRequest = (child: ChildProcess, request: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const stdin = child?.stdin;
    if (!stdin || stdin.destroyed) {
      reject(new Error('aurral-worker daemon stdin is not writable'));
      return;
    }
    const onError = (err: Error) => {
      stdin.off('error', onError);
      reject(err);
    };
    stdin.once('error', onError);
    stdin.write(request, (err: Error | null | undefined) => {
      stdin.off('error', onError);
      if (err) reject(err);
      else resolve(undefined);
    });
  });

const handleDaemonLine = (line: unknown): void => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return;
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (!parsed) return;
  const id = String(parsed.id || '').trim();
  if (!id || !daemonPending.has(id)) return;
  const entry = daemonPending.get(id)!;
  daemonPending.delete(id);
  if (entry.timer) clearTimeout(entry.timer);
  if (parsed.ok === false) {
    entry.reject(new Error(String(parsed.error || 'aurral-worker daemon job failed')));
    return;
  }
  entry.resolve({
    ok: true,
    result: (parsed.result as Record<string, unknown>) || {},
    stats: parsed.stats || null,
  });
};

const ensureDaemonProcess = async (): Promise<ChildProcess> => {
  if (daemonProcess && !daemonProcess.killed) {
    return daemonProcess;
  }
  if (daemonReady) {
    await daemonReady;
    return daemonProcess!;
  }

  const binaryPath = resolveRustWorkerBinary();
  if (!binaryPath) {
    throw new Error('aurral-worker binary not found');
  }
  if (!getLastfmApiKey()) {
    throw new Error('Last.fm API key is not configured');
  }

  daemonReady = new Promise<ChildProcess>((resolve, reject) => {
    buildRustWorkerEnv()
      .then((env) => {
        const child = spawn(binaryPath, ['daemon'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: env as Record<string, string>,
        });
        daemonProcess = child;
        daemonBuffer = '';

        child.stdout.on('data', (chunk: Buffer) => {
          daemonBuffer += String(chunk || '');
          let newlineIndex = daemonBuffer.indexOf('\n');
          while (newlineIndex >= 0) {
            const line = daemonBuffer.slice(0, newlineIndex);
            daemonBuffer = daemonBuffer.slice(newlineIndex + 1);
            handleDaemonLine(line);
            newlineIndex = daemonBuffer.indexOf('\n');
          }
        });

        child.stderr.on('data', (chunk: Buffer) => {
          const message = String(chunk || '').trim();
          if (message) {
            console.warn(`[rustWorker] ${message}`);
          }
        });

        child.stdin!.on('error', (err: Error) => {
          if (!isBrokenPipeError(err)) {
            console.warn(`[rustWorker] daemon stdin error: ${err.message}`);
          }
          resetDaemonProcess(new Error(`aurral-worker daemon stdin closed: ${err.message}`));
        });

        child.on('error', (err: Error) => {
          resetDaemonProcess(err);
          reject(err);
        });

        child.on('close', (code: number | null) => {
          resetDaemonProcess(new Error(`aurral-worker daemon exited ${code ?? 'unknown'}`));
        });

        resolve(child);
      })
      .catch(reject);
  });

  await daemonReady;
  return daemonProcess!;
};

const runRustWorkerDaemonJob = (jobType: string, payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> =>
  new Promise<unknown>((resolve, reject) => {
    void (async () => {
      try {
        const child = await ensureDaemonProcess();
        const id = `${Date.now()}-${++daemonRequestCounter}`;
        const timer: ReturnType<typeof setTimeout> | undefined =
          timeoutMs > 0
            ? setTimeout(() => {
                if (!daemonPending.has(id)) return;
                daemonPending.delete(id);
                reject(new Error(`aurral-worker ${jobType} timed out after ${timeoutMs}ms`));
              }, timeoutMs)
            : undefined;

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
            resetDaemonProcess(error as Error);
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
    })();
  });

const runRustWorkerProcess = (jobType: string, payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> =>
  new Promise<unknown>((resolve, reject) => {
    const binaryPath = resolveRustWorkerBinary();
    if (!binaryPath) {
      reject(new Error('aurral-worker binary not found'));
      return;
    }
    if (!getLastfmApiKey()) {
      reject(new Error('Last.fm API key is not configured'));
      return;
    }

    buildRustWorkerEnv()
      .then((env) => {
        const child = spawn(binaryPath, [jobType], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: env as Record<string, string>,
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        let timer: ReturnType<typeof setTimeout> | undefined;

        const finish = (error: Error | null, value?: unknown): void => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (error) reject(error);
          else resolve(value);
        };

        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            child.kill('SIGTERM');
            finish(new Error(`aurral-worker ${jobType} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }

        child.stdout.on('data', (chunk: Buffer) => {
          stdout += String(chunk || '');
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += String(chunk || '');
        });
        child.on('error', (err: Error) => finish(err, undefined));
        child.on('close', (code: number | null) => {
          if (code !== 0) {
            finish(
              new Error(
                `aurral-worker ${jobType} exited ${code}: ${stderr.trim() || stdout.trim() || 'unknown error'}`,
              ),
              undefined,
            );
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim() || '{}');
            if (parsed?.ok === false) {
              finish(new Error(String(parsed.error || `aurral-worker ${jobType} failed`)), undefined);
              return;
            }
            finish(null, parsed);
          } catch (err) {
            finish(new Error(`aurral-worker ${jobType} returned invalid JSON: ${(err as Error).message}`), undefined);
          }
        });

        child.stdin!.on('error', (err: Error) => {
          if (!settled && !isBrokenPipeError(err)) {
            finish(err, undefined);
          }
        });

        child.stdin!.end(JSON.stringify(payload), 'utf8', () => {
          // end() callback does not provide error
        });
      })
      .catch(reject);
  });

export async function runRustWorkerJob(jobType: string, payload: Record<string, unknown>, options: { timeoutMs?: number; useDaemon?: boolean } = {}): Promise<unknown> {
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || 45 * 60 * 1000);
  const useDaemon = options.useDaemon !== false;
  return withWorkerPerfSpan(
    `rust-worker:${jobType}`,
    () =>
      useDaemon
        ? runRustWorkerDaemonJob(jobType, payload, timeoutMs)
        : runRustWorkerProcess(jobType, payload, timeoutMs),
    ((payload as Record<string, unknown>)?.discoveryRunId || (payload as Record<string, unknown>)?.cacheNamespace || null) as string | null,
  );
}

export async function runRustDiscoveryRefresh(payload: Record<string, unknown>): Promise<unknown> {
  return runRustWorkerJob('discovery-refresh', payload);
}

export async function runRustDiscoveryRun(payload: Record<string, unknown>): Promise<unknown> {
  return runRustWorkerJob('discovery-run', payload);
}

export async function runRustDiscoveryPipeline(payload: Record<string, unknown>): Promise<unknown> {
  return runRustWorkerJob('discovery-pipeline', payload, { useDaemon: false });
}

export async function runRustDiscoveryPrep(payload: Record<string, unknown>): Promise<unknown> {
  return runRustWorkerJob('discovery-prep', payload, { useDaemon: false });
}

export async function runRustFlowPlan(payload: Record<string, unknown>): Promise<unknown> {
  return runRustWorkerJob('flow-plan', payload, { useDaemon: false });
}

export async function runRustPlaylistPlan(payload: Record<string, unknown>): Promise<unknown> {
  return runRustWorkerJob('playlist-plan', payload, { useDaemon: false });
}

export function shutdownRustWorkerDaemon(): void {
  resetDaemonProcess(new Error('aurral-worker daemon shutting down'));
}
