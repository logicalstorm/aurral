import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Loader, MapPin, Music } from "lucide-react";
import {
  formatLifeSpan,
  getArtistHeroImage,
  getArtistType,
  getTagColor,
} from "../utils";

const normalizeTagName = (value) => String(value || "").trim();

const buildTags = (artist) => {
  const seen = new Set();
  const tags = [];
  const source = [
    ...(Array.isArray(artist?.genres) ? artist.genres : []),
    ...(Array.isArray(artist?.tags) ? artist.tags : []),
  ];
  for (const item of source) {
    const name = normalizeTagName(typeof item === "string" ? item : item?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push({ key, name });
  }
  return tags;
};

export function ArtistDetailsHero({
  artist,
  coverImages,
  loadingCover,
  existsInLibrary,
  loadingLibrary,
  onCoverError,
  onNavigate,
}) {
  const heroImage = getArtistHeroImage(coverImages);
  const [imageFailed, setImageFailed] = useState(false);
  const tags = useMemo(() => buildTags(artist), [artist]);
  const visibleTags = tags.slice(0, 8);
  const artistType = getArtistType(artist?.type);
  const lifeSpan = formatLifeSpan(artist?.["life-span"]);
  const releaseCount = Number(artist?.["release-group-count"] || 0);
  const location = artist?.area?.name || artist?.country || "";
  const showImage = heroImage && !imageFailed;

  return (
    <section className="relative -mx-4 -mt-4 overflow-hidden bg-[#101012] md:-mx-8 md:-mt-8 lg:-mx-10 lg:-mt-10">
      <div className="relative min-h-[360px] px-4 pb-8 pt-24 md:min-h-[430px] md:px-8 md:pb-10 lg:px-10">
        {showImage ? (
          <>
            <img
              src={heroImage}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              loading="eager"
              decoding="async"
              onError={() => {
                setImageFailed(true);
                onCoverError?.();
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/45 to-[#050505]" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/25 to-black/20" />
          </>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(112,126,97,0.24),transparent_30%),linear-gradient(145deg,#18181c_0%,#050505_76%)]" />
        )}

        <div className="relative z-10 flex min-h-[250px] flex-col justify-end">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white/80">
            {loadingCover && !showImage ? (
              <Loader className="h-4 w-4 animate-spin" />
            ) : (
              <Music className="h-4 w-4" />
            )}
            <span>Artist</span>
          </div>

          <h1 className="max-w-[1100px] break-words text-5xl font-black leading-[0.95] text-white sm:text-7xl lg:text-8xl">
            {artist.name}
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-medium text-white/80">
            {artistType && <span>{artistType}</span>}
            {location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-white/55" />
                {location}
              </span>
            )}
            {lifeSpan && <span>{lifeSpan}</span>}
            {releaseCount > 0 && (
              <span>
                {releaseCount.toLocaleString()} release
                {releaseCount === 1 ? "" : "s"}
              </span>
            )}
            <span>
              {loadingLibrary
                ? "Checking library"
                : existsInLibrary
                  ? "In your library"
                  : "Not in library"}
            </span>
          </div>

          {visibleTags.length > 0 && (
            <div className="mt-5 flex max-w-5xl flex-wrap gap-2">
              {visibleTags.map((tag) => (
                <button
                  key={tag.key}
                  type="button"
                  onClick={() =>
                    onNavigate?.(
                      `/search?q=${encodeURIComponent(`#${tag.name}`)}&type=tag`,
                    )
                  }
                  className="px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-85"
                  style={{ backgroundColor: getTagColor(tag.name) }}
                  title={`View artists with tag: ${tag.name}`}
                >
                  #{tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

ArtistDetailsHero.propTypes = {
  artist: PropTypes.object.isRequired,
  coverImages: PropTypes.array,
  loadingCover: PropTypes.bool,
  existsInLibrary: PropTypes.bool,
  loadingLibrary: PropTypes.bool,
  onCoverError: PropTypes.func,
  onNavigate: PropTypes.func,
};
