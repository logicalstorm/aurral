import path from 'path';
import fs from 'fs/promises';

export function sanitizePathPart(value: unknown, fallback = 'Unknown') {
  const text = String(value || '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim();
  return text || fallback;
}

export function normalizePositiveInteger(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const normalized = Math.floor(Number(value));
  return normalized > 0 ? normalized : null;
}

export function normalizeStringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
    : [];
}

export function parseStringListJson(value: unknown) {
  if (!value) return [];
  try {
    return normalizeStringList(JSON.parse(String(value)));
  } catch {
    return [];
  }
}

export function stringifyStringListJson(value: unknown) {
  const normalized = normalizeStringList(value);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

export function buildResolvedPlaylistTrack(job: any, payloadTrack: any = {}) {
  const track = payloadTrack && typeof payloadTrack === 'object' ? payloadTrack : {};
  return {
    artistName: job.artistName || track.artistName,
    trackName: job.trackName || track.trackName,
    albumName: job.albumName || track.albumName,
    artistMbid: job.artistMbid || track.artistMbid,
    albumMbid: job.albumMbid || track.albumMbid,
    trackMbid: job.trackMbid || track.trackMbid,
    releaseYear: job.releaseYear || track.releaseYear,
    durationMs: job.durationMs ?? track.durationMs ?? null,
    trackNumber: normalizePositiveInteger(job.trackNumber ?? track.trackNumber),
    albumTrackCount: normalizePositiveInteger(job.albumTrackCount ?? track.albumTrackCount),
    albumTrackTitles: normalizeStringList(
      (job.albumTrackTitles?.length ? job.albumTrackTitles : null) || track.albumTrackTitles,
    ),
    artistAliases:
      Array.isArray(job.artistAliases) && job.artistAliases.length
        ? job.artistAliases
        : normalizeStringList(track.artistAliases),
  };
}

export function joinUnderRoot(root: string, relativePath: string, fileName: string | null = null) {
  const parts = String(relativePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  if (fileName) {
    parts.push(fileName);
  }
  return path.join(root, ...parts);
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveAvailableTargetPath(targetPath: string) {
  if (!(await fileExists(targetPath))) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = path.join(dir, `${base} (${index})${ext}`);
    if (!(await fileExists(candidate))) return candidate;
  }
  return path.join(dir, `${base} (${Date.now()})${ext}`);
}

export async function commitImportToPlaylistLibrary(sourcePath: string, targetPath: string) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    return targetPath;
  }
  const resolvedTarget = await resolveAvailableTargetPath(targetPath);
  try {
    await fs.rename(sourcePath, resolvedTarget);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') throw error;
    const tempTarget = path.join(
      path.dirname(resolvedTarget),
      `.aurral-import-${process.pid}-${Date.now()}-${path.basename(resolvedTarget)}.tmp`,
    );
    await fs.copyFile(sourcePath, tempTarget);
    const [sourceStat, tempStat] = await Promise.all([fs.stat(sourcePath), fs.stat(tempTarget)]);
    if (sourceStat.size !== tempStat.size) {
      await fs.rm(tempTarget, { force: true }).catch(() => {});
      throw new Error('Imported file copy did not match source size');
    }
    await fs.rename(tempTarget, resolvedTarget);
    await fs.rm(sourcePath, { force: true });
  }
  return resolvedTarget;
}
