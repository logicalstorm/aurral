import path from "path";
import { resolveRemotePath, looksLikeExternalOnlyPath } from "./pathMappings.js";

let storedM3uPathMode = "local";
let storedM3uPathMappings = [];

function normalizePathSeparators(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

function normalizeM3uPathMappingEntry(entry) {
  const localRaw = String(entry?.local || "").trim();
  const remote = normalizePathSeparators(entry?.remote);
  if (!localRaw || !remote) return null;
  return {
    local: path.resolve(localRaw),
    remote,
  };
}

function pathMatchesPrefix(candidate, prefix) {
  const normalizedCandidate = normalizePathSeparators(candidate);
  const normalizedPrefix = normalizePathSeparators(prefix);
  if (!normalizedCandidate || !normalizedPrefix) return false;
  if (normalizedCandidate.toLowerCase() === normalizedPrefix.toLowerCase()) {
    return true;
  }
  return normalizedCandidate.toLowerCase().startsWith(`${normalizedPrefix.toLowerCase()}/`);
}

export function normalizeM3uPathMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "remote" ? "remote" : "local";
}

export function syncM3uPathMode(value) {
  storedM3uPathMode = normalizeM3uPathMode(value);
}

export function normalizeM3uPathMappings(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    const normalized = normalizeM3uPathMappingEntry(entry);
    if (!normalized) continue;
    const key = `${normalized.local.toLowerCase()}\0${normalized.remote.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result.sort((left, right) => {
    const lengthDiff = right.local.length - left.local.length;
    if (lengthDiff !== 0) return lengthDiff;
    return left.local.localeCompare(right.local);
  });
}

export function syncM3uPathMappings(value) {
  storedM3uPathMappings = normalizeM3uPathMappings(value);
}

export function parseM3uPathModeEnv() {
  const raw = String(process.env.M3U_PATH_MODE || "").trim();
  if (!raw) return null;
  return normalizeM3uPathMode(raw);
}

export function getM3uPathMode() {
  const fromEnv = parseM3uPathModeEnv();
  if (fromEnv) return fromEnv;
  return storedM3uPathMode;
}

export function parseM3uPathMappingsEnv() {
  const raw = String(process.env.M3U_PATH_MAPPINGS || "").trim();
  if (!raw) return [];
  return normalizeM3uPathMappings(
    raw
      .split(";")
      .map((segment) => {
        const pipe = segment.indexOf("|");
        if (pipe === -1) return null;
        return {
          local: segment.slice(0, pipe).trim(),
          remote: segment.slice(pipe + 1).trim(),
        };
      })
      .filter(Boolean),
  );
}

export function getM3uPathMappings() {
  return normalizeM3uPathMappings([...storedM3uPathMappings, ...parseM3uPathMappingsEnv()]);
}

export function resolveM3uVisiblePath(localPath, mappings = getM3uPathMappings()) {
  const raw = String(localPath || "").trim();
  if (!raw) return null;

  const resolved = path.resolve(raw);
  const normalized = resolved.replace(/\\/g, "/");
  for (const mapping of mappings) {
    const localNorm = path.resolve(mapping.local).replace(/\\/g, "/");
    if (!pathMatchesPrefix(normalized, localNorm)) continue;
    const suffix = normalized.slice(localNorm.length).replace(/^\//, "");
    const remoteBase = normalizePathSeparators(mapping.remote);
    return suffix ? `${remoteBase}/${suffix.split("/").join("/")}` : remoteBase;
  }

  return null;
}

export function resolveM3uTrackPath(
  job,
  localPath,
  mode = getM3uPathMode(),
  mappings = getM3uPathMappings(),
) {
  const resolvedLocal = String(localPath || "").trim();
  if (!resolvedLocal || mode !== "remote") {
    return resolvedLocal;
  }
  const mappedPath = resolveM3uVisiblePath(resolvedLocal, mappings);
  if (mappedPath) {
    return mappedPath;
  }
  const externalPath = String(job?.externalPath || "").trim();
  if (externalPath && looksLikeExternalOnlyPath(externalPath)) {
    return externalPath.replace(/\\/g, "/");
  }
  if (mappings.length > 0) {
    return resolvedLocal;
  }
  return resolveRemotePath(resolvedLocal);
}
