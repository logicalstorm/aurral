import { useMemo } from "react";
import PropTypes from "prop-types";
import { ExternalLink } from "lucide-react";
import { getArtistType, getTagColor } from "../utils";
import lidarrLogo from "../../../../images/logos/lidarr.svg?raw";
import lastFmLogo from "../../../../images/logos/last-fm.svg?raw";
import musicBrainzLogo from "../../../../images/logos/musicbrainz.svg?raw";
import listenBrainzLogo from "../../../../images/logos/listenbrainz.svg?raw";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toCurrentColorSvg = (svg) =>
  svg
    .replace(/fill:#fff/gi, "fill:currentColor")
    .replace(/fill="#fff"/gi, 'fill="currentColor"')
    .replace(/fill:#ffffff/gi, "fill:currentColor")
    .replace(/fill="#ffffff"/gi, 'fill="currentColor"');

const normalizeHref = (value) => {
  const href = String(value || "").trim();
  if (!href) return null;
  try {
    return new URL(href).toString();
  } catch {
    return null;
  }
};

const hostnameLabel = (href) => {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
};

const buildTags = (artist) => {
  const seen = new Set();
  const out = [];
  const source = [
    ...(Array.isArray(artist?.genres) ? artist.genres : []),
    ...(Array.isArray(artist?.tags) ? artist.tags : []),
  ];
  for (const item of source) {
    const name = String(typeof item === "string" ? item : item?.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name });
  }
  return out;
};

const buildRelationLinks = (artist) => {
  const direct = Array.isArray(artist?.links) ? artist.links : [];
  const relationSource =
    direct.length > 0
      ? direct.map((link, index) => ({
          key: `link-${index}`,
          href: link?.target || link?.url,
          label: link?.type,
        }))
      : Array.isArray(artist?.relations)
        ? artist.relations.map((relation, index) => ({
            key: `relation-${index}`,
            href: relation?.url?.resource,
            label: relation?.type,
          }))
        : [];

  return relationSource
    .map((link) => {
      const href = normalizeHref(link.href);
      if (!href) return null;
      return {
        ...link,
        href,
        label: link.label || hostnameLabel(href),
      };
    })
    .filter(Boolean);
};

export function ArtistDetailsAbout({
  artist,
  libraryArtist,
  appSettings,
  existsInLibrary,
}) {
  const tags = useMemo(() => buildTags(artist), [artist]);
  const links = useMemo(() => {
    const lidarrArtistId =
      artist?.id ||
      libraryArtist?.foreignArtistId ||
      libraryArtist?.mbid ||
      artist?._lidarrData?.foreignArtistId;
    const lidarrUrl =
      appSettings?.integrations?.lidarr?.externalUrl ||
      appSettings?.integrations?.lidarr?.url;
    const lidarrHref =
      lidarrUrl && lidarrArtistId
        ? `${lidarrUrl.replace(/\/$/, "")}/${
            existsInLibrary
              ? `artist/${lidarrArtistId}`
              : `add/search?term=lidarr:${encodeURIComponent(lidarrArtistId)}`
          }`
        : null;
    const primary = [
      lidarrHref
        ? {
            key: "lidarr",
            label: "Lidarr",
            href: lidarrHref,
            logo: toCurrentColorSvg(lidarrLogo),
            color: "#009252",
          }
        : null,
      artist?.name
        ? {
            key: "lastfm",
            label: "Last.fm",
            href: `https://www.last.fm/music/${encodeURIComponent(artist.name)}`,
            logo: toCurrentColorSvg(lastFmLogo),
            color: "#D1170D",
          }
        : null,
      artist?.id && UUID_REGEX.test(artist.id)
        ? {
            key: "musicbrainz",
            label: "MusicBrainz",
            href: `https://musicbrainz.org/artist/${artist.id}`,
            logo: toCurrentColorSvg(musicBrainzLogo),
            color: "#BA478F",
          }
        : null,
      artist?.id && UUID_REGEX.test(artist.id)
        ? {
            key: "listenbrainz",
            label: "ListenBrainz",
            href: `https://listenbrainz.org/artist/${encodeURIComponent(
              artist.id,
            )}/`,
            logo: toCurrentColorSvg(listenBrainzLogo),
            color: "#353070",
          }
        : null,
    ].filter(Boolean);
    const seen = new Set(primary.map((link) => link.href));
    const secondary = buildRelationLinks(artist).filter((link) => {
      if (seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    });
    return [...primary, ...secondary];
  }, [appSettings, artist, existsInLibrary, libraryArtist]);

  if (!artist?.bio && tags.length === 0 && links.length === 0) return null;

  return (
    <section className="mb-10 max-w-5xl">
      <h2 className="mb-4 text-2xl font-bold text-white">About</h2>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="bg-[#101012] p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-white/50">
            {getArtistType(artist?.type) && <span>{getArtistType(artist.type)}</span>}
            {artist?.disambiguation && <span>{artist.disambiguation}</span>}
          </div>
          {artist?.bio ? (
            <p className="text-sm leading-7 text-white/75">{artist.bio}</p>
          ) : (
            <p className="text-sm text-white/45">No biography available.</p>
          )}
        </div>

        <aside className="space-y-4">
          {tags.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-bold text-white">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {tags.slice(0, 14).map((tag) => (
                  <span
                    key={tag.key}
                    className="px-2.5 py-1 text-xs font-semibold text-white"
                    style={{ backgroundColor: getTagColor(tag.name) }}
                  >
                    #{tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {links.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-bold text-white">Links</h3>
              <div className="flex flex-col items-start gap-2">
                {links.slice(0, 10).map((link) => (
                  <a
                    key={`${link.key}-${link.href}`}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-2 text-sm text-white/70 transition-colors hover:text-white"
                  >
                    {link.logo ? (
                      <span
                        className="flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full"
                        style={{ color: link.color || "#c1c1c3" }}
                        aria-hidden="true"
                        dangerouslySetInnerHTML={{ __html: link.logo }}
                      />
                    ) : (
                      <ExternalLink className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate">{link.label}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

ArtistDetailsAbout.propTypes = {
  artist: PropTypes.object.isRequired,
  libraryArtist: PropTypes.object,
  appSettings: PropTypes.object,
  existsInLibrary: PropTypes.bool,
};
