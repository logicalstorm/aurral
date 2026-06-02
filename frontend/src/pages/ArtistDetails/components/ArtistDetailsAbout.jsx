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
  coverImages,
}) {
  const tags = useMemo(() => buildTags(artist), [artist]);
  const visibleTags = tags.slice(0, 5);
  const artistTypeLabel = getArtistType(artist?.type);
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
  const aboutImage = useMemo(() => {
    const images = Array.isArray(coverImages) ? coverImages : [];
    const heroImage =
      images.find((image) => image?.front)?.image || images[0]?.image;
    const secondary = images.find(
      (image) => image?.image && image.image !== heroImage,
    );
    return secondary?.image || heroImage || null;
  }, [coverImages]);

  if (!artist?.bio && tags.length === 0 && links.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="mb-5 text-3xl font-black text-white">About</h2>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="relative min-h-[430px] overflow-hidden rounded-lg bg-[#101012] md:min-h-[520px]">
          {aboutImage ? (
            <img
              src={aboutImage}
              alt=""
              className="absolute inset-0 h-full w-full object-cover object-center"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="absolute inset-0 bg-[linear-gradient(145deg,#18181c_0%,#050505_76%)]" />
          )}
          <div className="absolute inset-0 bg-black/25" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/22 to-black/88" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/28 to-transparent" />

          {artist?.rating?.value != null && (
            <div className="absolute right-5 top-5 flex h-24 w-24 flex-col items-center justify-center rounded-full bg-[#1d8cf8] text-center shadow-2xl shadow-black/40 md:right-8 md:top-8 md:h-28 md:w-28">
              <span className="text-3xl font-black leading-none text-white">
                {Number(artist.rating.value).toFixed(1)}
              </span>
              <span className="mt-1 text-[11px] font-bold uppercase tracking-wide text-white/85">
                Rating
              </span>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7 md:max-w-3xl md:p-9">
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-bold text-white">
              {artistTypeLabel && <span>{artistTypeLabel}</span>}
              {artist?.disambiguation && <span>{artist.disambiguation}</span>}
              {visibleTags.length > 0 && (
                <span className="text-white/80">
                  {visibleTags.map((tag) => tag.name).join(" · ")}
                </span>
              )}
            </div>
            {artist?.bio ? (
              <p className="line-clamp-5 text-xl font-semibold leading-8 text-white shadow-black/40 [text-shadow:0_2px_16px_var(--tw-shadow-color)] sm:text-2xl sm:leading-9">
                {artist.bio}
              </p>
            ) : (
              <p className="text-lg font-semibold text-white/75">
                No biography available.
              </p>
            )}
          </div>
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
  coverImages: PropTypes.array,
};
