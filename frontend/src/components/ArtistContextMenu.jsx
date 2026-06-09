import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import {
  Library,
  Loader2,
  MoreVertical,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { getDiscoveryFeedbackLabel } from "../utils/discoveryFeedback";

const MAIN_CONTENT_PORTAL_SELECTOR = ".app-main-wrap";

const getMainContentPortalRoot = () =>
  document.querySelector(MAIN_CONTENT_PORTAL_SELECTOR);

export function ArtistContextMenu({
  artist,
  artistName,
  isInLibrary = false,
  canAddArtist = false,
  onAddToLibrary,
  onFeedback,
  feedbackUsed = {},
  className = "",
  buttonClassName = "btn btn-surface btn-icon-square",
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const menuButtonRef = useRef(null);
  const menuRef = useRef(null);
  const labelName = artistName || artist?.name || artist?.artistName || "artist";

  const estimateMenuHeight = useCallback(() => {
    let items = 0;
    if (canAddArtist && onAddToLibrary) items += 1;
    if (onFeedback) items += 2;
    return Math.max(items, 1) * 42 + 8;
  }, [canAddArtist, onAddToLibrary, onFeedback]);

  const updateMenuPosition = useCallback(() => {
    const button = menuButtonRef.current;
    const portalRoot = getMainContentPortalRoot();
    if (!button || !portalRoot) return;
    const wrapRect = portalRoot.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    const gap = 8;
    const menuHeight =
      menuRef.current?.offsetHeight || estimateMenuHeight();
    const spaceAbove = rect.top - wrapRect.top - gap;
    const spaceBelow = wrapRect.bottom - rect.bottom - gap;
    let placement = "above";
    if (spaceAbove < menuHeight && spaceBelow >= menuHeight) {
      placement = "below";
    } else if (spaceAbove < menuHeight && spaceBelow < menuHeight) {
      placement = spaceBelow > spaceAbove ? "below" : "above";
    }
    const top =
      placement === "below"
        ? rect.bottom - wrapRect.top + gap
        : rect.top - wrapRect.top - gap;
    const left = Math.max(rect.right - wrapRect.left - 176, 12);
    setMenuPosition((prev) => {
      if (
        prev &&
        prev.top === top &&
        prev.left === left &&
        prev.placement === placement
      ) {
        return prev;
      }
      return { top, left, placement };
    });
  }, [estimateMenuHeight]);

  useEffect(() => {
    if (!showMenu) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
    const scrollRoot = document.querySelector(".app-main");
    window.addEventListener("resize", updateMenuPosition);
    scrollRoot?.addEventListener("scroll", updateMenuPosition, { passive: true });
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      scrollRoot?.removeEventListener("scroll", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [showMenu, updateMenuPosition]);

  useLayoutEffect(() => {
    if (!showMenu) return;
    updateMenuPosition();
  }, [showMenu, updateMenuPosition]);

  const handleAction = async (event, type, fn) => {
    event.stopPropagation();
    if (!fn || pendingAction) return;
    setPendingAction(type);
    const success = await fn(artist);
    if (success) setShowMenu(false);
    setPendingAction(null);
  };

  const handleFeedbackClick = async (event, action) => {
    event.stopPropagation();
    if (!onFeedback || pendingAction) return;
    setPendingAction(action);
    await onFeedback(artist, action, {
      isSelected: !!feedbackUsed[action],
    });
    setPendingAction(null);
  };

  const showMenuTrigger =
    (canAddArtist && onAddToLibrary) || onFeedback;

  if (!showMenuTrigger) return null;

  return (
    <div
      className={className}
      style={{ position: "relative", flexShrink: 0 }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        ref={menuButtonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setShowMenu((prev) => !prev);
        }}
        className={buttonClassName}
        aria-label={`Artist options for ${labelName}`}
      >
        <MoreVertical className="artist-icon-sm" />
      </button>
      {showMenu && menuPosition && getMainContentPortalRoot()
        ? createPortal(
            <div
              ref={menuRef}
              className={`artist-options-menu--discover${menuPosition.placement === "below" ? " is-below" : ""}`}
              style={{
                top: menuPosition.top,
                left: menuPosition.left,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {canAddArtist && onAddToLibrary && (
                <button
                  type="button"
                  onClick={(event) =>
                    handleAction(event, "library", onAddToLibrary)
                  }
                  disabled={isInLibrary || !!pendingAction}
                  className="artist-menu-item--discover"
                >
                  <div className="artist-menu-item__main--discover">
                    {pendingAction === "library" ? (
                      <Loader2 className="artist-icon-sm animate-spin" />
                    ) : (
                      <Library className="artist-icon-sm" />
                    )}
                    {isInLibrary ? "In Library" : "Add to Library"}
                  </div>
                </button>
              )}
              {onFeedback && (
                <>
                  <button
                    type="button"
                    onClick={(event) =>
                      handleFeedbackClick(event, "more_like_this")
                    }
                    disabled={!!pendingAction}
                    className={`artist-menu-item--discover${feedbackUsed.more_like_this ? " is-selected" : ""}`}
                  >
                    <div className="artist-menu-item__main--discover">
                      {pendingAction === "more_like_this" ? (
                        <Loader2 className="artist-icon-sm animate-spin" />
                      ) : (
                        <ThumbsUp className="artist-icon-sm" />
                      )}
                      {getDiscoveryFeedbackLabel("more_like_this")}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(event) =>
                      handleFeedbackClick(event, "less_like_this")
                    }
                    disabled={!!pendingAction}
                    className={`artist-menu-item--discover${feedbackUsed.less_like_this ? " is-selected" : ""}`}
                  >
                    <div className="artist-menu-item__main--discover">
                      {pendingAction === "less_like_this" ? (
                        <Loader2 className="artist-icon-sm animate-spin" />
                      ) : (
                        <ThumbsDown className="artist-icon-sm" />
                      )}
                      {getDiscoveryFeedbackLabel("less_like_this")}
                    </div>
                  </button>
                </>
              )}
            </div>,
            getMainContentPortalRoot(),
          )
        : null}
    </div>
  );
}

ArtistContextMenu.propTypes = {
  artist: PropTypes.object.isRequired,
  artistName: PropTypes.string,
  isInLibrary: PropTypes.bool,
  canAddArtist: PropTypes.bool,
  onAddToLibrary: PropTypes.func,
  onFeedback: PropTypes.func,
  feedbackUsed: PropTypes.shape({
    more_like_this: PropTypes.bool,
    less_like_this: PropTypes.bool,
  }),
  className: PropTypes.string,
  buttonClassName: PropTypes.string,
};
