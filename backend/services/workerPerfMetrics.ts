import { performance } from 'node:perf_hooks';

const MAX_HISTORY = 64;
const history: Record<string, unknown>[] = [];

const snapshotResources = () => {
  const memory = process.memoryUsage();
  return {
    heapUsed: memory.heapUsed,
    heapTotal: memory.heapTotal,
    rss: memory.rss,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
  };
};

const formatMb = (bytes: unknown) => Math.round((Number(bytes || 0) / (1024 * 1024)) * 100) / 100;

export function captureResourceSnapshot() {
  return snapshotResources();
}

export function getWorkerPerfHistory(limit = MAX_HISTORY) {
  return history.slice(-Math.max(1, limit));
}

export function recordWorkerPerfSpan(entry: Record<string, unknown>) {
  const span: Record<string, unknown> = {
    ...entry,
    recordedAt: new Date().toISOString(),
  };
  history.push(span);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  const heapMb = formatMb((span.memoryEnd as Record<string, unknown>)?.heapUsed);
  const rssMb = formatMb((span.memoryEnd as Record<string, unknown>)?.rss);
  const cpuMs =
    (span.cpuUserUs as number) != null && (span.cpuSystemUs as number) != null
      ? Math.round(((span.cpuUserUs as number) + (span.cpuSystemUs as number)) / 1000)
      : null;
  console.log(
    `[workerPerf] ${span.name} ${span.ok === false ? 'FAILED' : 'ok'} ` +
      `${span.durationMs}ms heap=${heapMb}MB rss=${rssMb}MB` +
      (cpuMs != null ? ` cpu=${cpuMs}ms` : '') +
      (span.detail ? ` ${span.detail}` : ''),
  );
  return span;
}

export async function withWorkerPerfSpan<T>(
  name: string,
  fn: () => Promise<T>,
  detail: string | null = null,
) {
  const startedAt = performance.now();
  const memoryStart = snapshotResources();
  const cpuStart = process.cpuUsage();
  let ok = true;
  let errorMessage = null;
  let result;
  try {
    result = await fn();
    return result;
  } catch (error: unknown) {
    ok = false;
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const durationMs = Math.round(performance.now() - startedAt);
    const memoryEnd = snapshotResources();
    const cpuDelta = process.cpuUsage(cpuStart);
    recordWorkerPerfSpan({
      name,
      detail,
      ok,
      errorMessage,
      durationMs,
      memoryStart,
      memoryEnd,
      heapDelta: memoryEnd.heapUsed - memoryStart.heapUsed,
      rssDelta: memoryEnd.rss - memoryStart.rss,
      cpuUserUs: cpuDelta.user,
      cpuSystemUs: cpuDelta.system,
    });
  }
}

export function summarizeWorkerPerfHistory(limit = 16) {
  const spans = getWorkerPerfHistory(limit);
  if (spans.length === 0) return { count: 0, spans: [] };
  const peakRss = Math.max(...spans.map((span) => ((span.memoryEnd as Record<string, unknown>)?.rss as number) || 0));
  const peakHeap = Math.max(...spans.map((span) => ((span.memoryEnd as Record<string, unknown>)?.heapUsed as number) || 0));
  const totalDurationMs = spans.reduce(
    (sum: number, span) => sum + Number(span.durationMs || 0),
    0,
  );
  return {
    count: spans.length,
    peakRssMb: formatMb(peakRss),
    peakHeapMb: formatMb(peakHeap),
    totalDurationMs,
    spans,
  };
}
