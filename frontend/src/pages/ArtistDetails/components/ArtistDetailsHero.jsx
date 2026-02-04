import PropTypes from "prop-types";
import {
  Loader,
  Music,
  ExternalLink,
  CheckCircle,
  Plus,
  RefreshCw,
  ChevronDown,
  Calendar,
  MapPin,
  Trash2,
} from "lucide-react";
import { getCoverImage, getTagColor, formatLifeSpan, getArtistType } from "../utils";

export function ArtistDetailsHero({
  artist,
  coverImages,
  loadingCover,
  loadingLibrary,
  existsInLibrary,
  showRemoveDropdown,
  setShowRemoveDropdown,
  showMonitorOptionMenu,
  setShowMonitorOptionMenu,
  updatingMonitor,
  getCurrentMonitorOption,
  handleUpdateMonitorOption,
  handleDeleteClick,
  handleAddToLibrary,
  handleRefreshArtist,
  refreshingArtist,
  onNavigate,
}) {
  const coverImage = getCoverImage(coverImages);
  const lifeSpan = formatLifeSpan(artist["life-span"]);

  return (
    <div className="card mb-8 relative">
      {existsInLibrary && (
        <button
          onClick={handleRefreshArtist}
          disabled={refreshingArtist}
          className="absolute top-4 right-4 btn btn-secondary btn-sm p-2"
          title="Refresh & Scan Artist"
        >
          {refreshingArtist ? (
            <Loader className="w-5 h-5 animate-spin" />
          ) : (
            <RefreshCw className="w-5 h-5" />
          )}
        </button>
      )}
      <div className="flex flex-col md:flex-row gap-6">
        <div
          className="w-full md:w-64 h-64 flex-shrink-0 overflow-hidden relative"
          style={{ backgroundColor: "#211f27" }}
        >
          {loadingCover ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader
                className="w-12 h-12 animate-spin"
                style={{ color: "#c1c1c3" }}
              />
            </div>
          ) : coverImage ? (
            <img
              src={coverImage}
              alt={artist.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music className="w-24 h-24" style={{ color: "#c1c1c3" }} />
            </div>
          )}
        </div>

        <div className="flex-1">
          <h1 className="text-4xl font-bold mb-2" style={{ color: "#fff" }}>
            {artist.name}
          </h1>

          {artist["sort-name"] && artist["sort-name"] !== artist.name && (
            <p className="text-lg mb-4" style={{ color: "#c1c1c3" }}>
              {artist["sort-name"]}
            </p>
          )}

          {artist.disambiguation && (
            <p className="italic mb-4" style={{ color: "#c1c1c3" }}>
              {artist.disambiguation}
            </p>
          )}

          {artist.bio && (
            <p
              className="text-sm mb-4 line-clamp-6 max-w-2xl"
              style={{ color: "#c1c1c3" }}
              title={artist.bio}
            >
              {artist.bio}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {artist.type && (
              <div className="flex items-center" style={{ color: "#fff" }}>
                <Music
                  className="w-5 h-5 mr-2"
                  style={{ color: "#c1c1c3" }}
                />
                <span className="font-medium mr-2">Type:</span>
                <span>{getArtistType(artist.type)}</span>
              </div>
            )}

            {lifeSpan && (
              <div className="flex items-center" style={{ color: "#fff" }}>
                <Calendar
                  className="w-5 h-5 mr-2"
                  style={{ color: "#c1c1c3" }}
                />
                <span className="font-medium mr-2">Active:</span>
                <span>{lifeSpan}</span>
              </div>
            )}

            {artist.country && (
              <div className="flex items-center" style={{ color: "#fff" }}>
                <MapPin
                  className="w-5 h-5 mr-2"
                  style={{ color: "#c1c1c3" }}
                />
                <span className="font-medium mr-2">Country:</span>
                <span>{artist.country}</span>
              </div>
            )}

            {artist.area && artist.area.name && (
              <div className="flex items-center" style={{ color: "#fff" }}>
                <MapPin
                  className="w-5 h-5 mr-2"
                  style={{ color: "#c1c1c3" }}
                />
                <span className="font-medium mr-2">Area:</span>
                <span>{artist.area.name}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            {loadingLibrary ? (
              <div
                className="btn btn-secondary inline-flex items-center"
                disabled
              >
                <Loader className="w-5 h-5 mr-2 animate-spin" />
                Loading...
              </div>
            ) : existsInLibrary ? (
              <>
                <div className="relative inline-flex">
                  <button
                    type="button"
                    onClick={() => setShowRemoveDropdown(!showRemoveDropdown)}
                    className="btn btn-success inline-flex items-center"
                  >
                    <CheckCircle className="w-5 h-5 mr-2" />
                    In Your Library
                    <ChevronDown
                      className={`w-4 h-4 ml-2 transition-transform ${
                        showRemoveDropdown ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {showRemoveDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowRemoveDropdown(false)}
                      />
                      <div
                        className="absolute right-0 top-full w-56 z-20 py-1 rounded shadow-lg border border-white/10"
                        style={{ backgroundColor: "#2a2830" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowMonitorOptionMenu(!showMonitorOptionMenu);
                          }}
                          disabled={updatingMonitor}
                          className="w-full text-left px-4 py-2 text-sm  hover:bg-gray-900/50 transition-colors flex items-center justify-between"
                          style={{ color: "#fff" }}
                        >
                          <span>Change Monitor Option</span>
                          <ChevronDown
                            className={`w-4 h-4 transition-transform ${
                              showMonitorOptionMenu ? "rotate-180" : ""
                            }`}
                          />
                        </button>

                        {showMonitorOptionMenu && (
                          <>
                            <div className="my-1" />
                            {[
                              { value: "none", label: "None (Artist Only)" },
                              { value: "all", label: "All Albums" },
                              { value: "future", label: "Future Albums" },
                              { value: "missing", label: "Missing Albums" },
                              { value: "latest", label: "Latest Album" },
                              { value: "first", label: "First Album" },
                            ].map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpdateMonitorOption(option.value);
                                  setShowMonitorOptionMenu(false);
                                  setShowRemoveDropdown(false);
                                }}
                                disabled={updatingMonitor}
                                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-900/50 transition-colors"
                                style={
                                  getCurrentMonitorOption() === option.value
                                    ? {
                                        backgroundColor: "#211f27",
                                        color: "#fff",
                                        fontWeight: "500",
                                      }
                                    : { color: "#fff" }
                                }
                              >
                                {option.label}
                              </button>
                            ))}
                          </>
                        )}

                        <div className=" my-1" />
                        <button
                          type="button"
                          onClick={() => {
                            handleDeleteClick();
                            setShowRemoveDropdown(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors flex items-center"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Remove from Library
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <button
                onClick={handleAddToLibrary}
                className="btn bg-[#2a2830] hover:bg-[#3a3840] btn-secondary inline-flex items-center"
              >
                <Plus className="w-5 h-5 mr-2" />
                Add to Library
              </button>
            )}

            <a
              href={`https://www.last.fm/music/${encodeURIComponent(
                artist.name
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary inline-flex items-center"
            >
              <ExternalLink className="w-5 h-5 mr-2" />
              View on Last.fm
            </a>
            {artist.id &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                artist.id
              ) && (
                <a
                  href={`https://musicbrainz.org/artist/${artist.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary inline-flex items-center"
                >
                  <ExternalLink className="w-5 h-5 mr-2" />
                  View on MusicBrainz
                </a>
              )}
          </div>
        </div>
      </div>

      {artist && (
        <div className="mt-3 pt-3">
          <h3
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: "#c1c1c3" }}
          >
            Tags
          </h3>
          <div className="flex flex-wrap gap-2">
            {artist.genres &&
              artist.genres.map((genre, idx) => {
                const name = typeof genre === "string" ? genre : genre?.name;
                if (!name) return null;
                return (
                  <button
                    key={`genre-${idx}`}
                    onClick={() =>
                      onNavigate(
                        `/search?q=${encodeURIComponent(`#${name}`)}&type=tag`
                      )
                    }
                    className="badge genre-tag-pill text-sm px-3 py-1 cursor-pointer"
                    style={{
                      backgroundColor: getTagColor(name),
                      color: "#fff",
                    }}
                    title={`View artists with tag: ${name}`}
                  >
                    #{name}
                  </button>
                );
              })}
            {artist.tags &&
              artist.tags.map((tag, idx) => {
                const name = typeof tag === "string" ? tag : tag?.name;
                if (!name) return null;
                return (
                  <button
                    key={`tag-${idx}`}
                    onClick={() =>
                      onNavigate(
                        `/search?q=${encodeURIComponent(`#${name}`)}&type=tag`
                      )
                    }
                    className="badge genre-tag-pill text-sm px-3 py-1 cursor-pointer"
                    style={{
                      backgroundColor: getTagColor(name),
                      color: "#fff",
                    }}
                    title={`View artists with tag: ${name}`}
                  >
                    #{name}
                  </button>
                );
              })}
            {(!artist.genres || artist.genres.length === 0) &&
              (!artist.tags || artist.tags.length === 0) && (
                <span className="text-sm" style={{ color: "#c1c1c3" }}>
                  No tags
                </span>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

ArtistDetailsHero.propTypes = {
  artist: PropTypes.object.isRequired,
  coverImages: PropTypes.arrayOf(
    PropTypes.shape({
      front: PropTypes.bool,
      image: PropTypes.string,
    })
  ),
  loadingCover: PropTypes.bool,
  loadingLibrary: PropTypes.bool,
  existsInLibrary: PropTypes.bool,
  showRemoveDropdown: PropTypes.bool,
  setShowRemoveDropdown: PropTypes.func,
  showMonitorOptionMenu: PropTypes.bool,
  setShowMonitorOptionMenu: PropTypes.func,
  updatingMonitor: PropTypes.bool,
  getCurrentMonitorOption: PropTypes.func,
  handleUpdateMonitorOption: PropTypes.func,
  handleDeleteClick: PropTypes.func,
  handleAddToLibrary: PropTypes.func,
  handleRefreshArtist: PropTypes.func,
  refreshingArtist: PropTypes.bool,
  onNavigate: PropTypes.func,
};
