import fs from "node:fs/promises";
import path from "node:path";
import { dbOps } from "../config/db-helpers.js";
import { buildPlaylistArtworkWebpBuffer } from "./playlistArtwork.js";
import {
  fetchImageBuffer,
  renderStylizedPhotoArtwork,
} from "./stylizedPhotoArtwork.js";

export const PLAYLIST_ARTWORK_STYLES = ["aurral", "photo"];

export function getPlaylistArtworkStyle() {
  const settings = dbOps.getSettings() || {};
  const style = String(
    settings?.playlistArtwork?.style ||
      settings?.integrations?.lastfm?.discoverFlowArtworkStyle ||
      "photo",
  )
    .trim()
    .toLowerCase();
  return PLAYLIST_ARTWORK_STYLES.includes(style) ? style : "photo";
}

export function getArtworkExtensionForStyle(style = getPlaylistArtworkStyle()) {
  return style === "photo" ? ".jpg" : ".webp";
}

export function getArtworkContentTypeForExtension(extension) {
  const normalized = String(extension || "").toLowerCase();
  if (normalized === ".webp") return "image/webp";
  if (normalized === ".jpg" || normalized === ".jpeg") return "image/jpeg";
  return "image/png";
}

export async function resolvePlaylistSourceImageUrl({ signature } = {}) {
  const seed = String(signature || "playlist").trim() || "playlist";
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/800/800`;
}

export async function buildGeneratedPlaylistArtworkBuffer({
  title,
  kind = "Playlist",
  signature,
  relatedArtists = [],
  style = null,
}) {
  const resolvedStyle = style || getPlaylistArtworkStyle();
  const displayTitle = String(title || "").trim() || "Untitled";
  const resolvedSignature = String(signature || displayTitle).trim();

  if (resolvedStyle === "aurral") {
    return buildPlaylistArtworkWebpBuffer({
      playlistName: displayTitle,
      kind,
    });
  }

  const sourceImageUrl = await resolvePlaylistSourceImageUrl({
    signature: resolvedSignature,
  });
  const sourceBuffer = await fetchImageBuffer(sourceImageUrl);
  return renderStylizedPhotoArtwork({
    imageBuffer: sourceBuffer,
    title: displayTitle,
    signature: resolvedSignature,
  });
}

const resolveArtworkOutputPath = (outputPath, style) => {
  const extension = getArtworkExtensionForStyle(style);
  const directory = path.dirname(outputPath);
  const baseName = path.basename(outputPath, path.extname(outputPath));
  return path.join(directory, `${baseName}${extension}`);
};

export async function writeGeneratedPlaylistArtwork({
  outputPath,
  title,
  kind = "Playlist",
  signature,
  relatedArtists = [],
  style = null,
}) {
  const resolvedStyle = style || getPlaylistArtworkStyle();
  const targetPath = resolveArtworkOutputPath(outputPath, resolvedStyle);
  const directory = path.dirname(targetPath);
  const baseName = path.basename(targetPath, path.extname(targetPath));
  const keepExtension = path.extname(targetPath);

  for (const extension of [".jpg", ".webp", ".png"]) {
    if (extension === keepExtension) continue;
    await fs
      .unlink(path.join(directory, `${baseName}${extension}`))
      .catch(() => {});
  }

  const buffer = await buildGeneratedPlaylistArtworkBuffer({
    title,
    kind,
    signature,
    relatedArtists,
    style: resolvedStyle,
  });
  await fs.writeFile(targetPath, buffer);
  return targetPath;
}
