import PropTypes from "prop-types";
import { Music, Star } from "lucide-react";
import AddAlbumButton from "../../../components/AddAlbumButton";
import { buildAurralPick, getReleaseMetric } from "../utils";

function PickCover({ pick, albumCovers }) {
  const cover = albumCovers?.[pick.releaseGroupId];
  if (cover) {
    return (
      <img
        src={cover}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-white/[0.06]">
      <Music className="h-14 w-14 text-white/35" />
    </div>
  );
}

PickCover.propTypes = {
  pick: PropTypes.object.isRequired,
  albumCovers: PropTypes.object,
};

export function ArtistDetailsDownloadTargets({
  targets,
  albumCovers,
  canAddAlbum,
  requestingAlbum,
  handleRequestAlbum,
}) {
  const missingReleasePick =
    targets.find((target) => target.source === "release") ||
    buildAurralPick(targets);
  if (!missingReleasePick) return null;

  const metric =
    missingReleasePick.metric || getReleaseMetric(missingReleasePick.releaseGroup);
  return (
    <section className="mb-10">
      <div className="relative overflow-hidden bg-[#101012]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(112,126,97,0.32),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_38%)]" />
        <div className="relative grid gap-5 p-5 sm:grid-cols-[180px_minmax(0,1fr)] md:p-6">
          <div className="aspect-square overflow-hidden bg-white/[0.06] shadow-2xl shadow-black/30">
            <PickCover pick={missingReleasePick} albumCovers={albumCovers} />
          </div>
          <div className="flex min-w-0 flex-col justify-between gap-5">
            <div className="min-w-0">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white">
                Aurral Pick
              </div>
              <h2 className="max-w-4xl break-words text-3xl font-black leading-tight text-white sm:text-4xl">
                {missingReleasePick.title}
              </h2>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/60">
                {missingReleasePick.year && <span>{missingReleasePick.year}</span>}
                {missingReleasePick.type && <span>{missingReleasePick.type}</span>}
                {metric?.label && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-4 w-4 text-yellow-400" />
                    {metric.label}
                  </span>
                )}
              </div>
            </div>
            {canAddAlbum && missingReleasePick.releaseGroupId && (
              <div>
                <AddAlbumButton
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRequestAlbum(
                      missingReleasePick.releaseGroupId,
                      missingReleasePick.title,
                    );
                  }}
                  isLoading={requestingAlbum === missingReleasePick.releaseGroupId}
                  disabled={requestingAlbum === missingReleasePick.releaseGroupId}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

ArtistDetailsDownloadTargets.propTypes = {
  targets: PropTypes.arrayOf(PropTypes.object).isRequired,
  albumCovers: PropTypes.object,
  canAddAlbum: PropTypes.bool,
  requestingAlbum: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  handleRequestAlbum: PropTypes.func.isRequired,
};
