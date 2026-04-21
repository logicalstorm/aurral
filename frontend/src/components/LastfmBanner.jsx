import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMyLastfm } from "../utils/api";

const DISMISS_KEY = "lastfm_banner_dismissed";

const LastfmBanner = () => {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === "1",
  );
  const [lastfmUsername, setLastfmUsername] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (dismissed) return;
    getMyLastfm()
      .then((d) => setLastfmUsername(d.lastfmUsername || ""))
      .catch(() => {});
  }, [dismissed]);

  if (dismissed || lastfmUsername === null || lastfmUsername !== "") {
    return null;
  }

  return (
    <div className="mb-6 bg-[#211f27] px-5 py-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-sm uppercase tracking-wide">
            Personalize your discovery
          </p>
          <p className="text-xs text-[#c1c1c3]">
            Recommendations are based on the admin&apos;s Last.fm account by
            default. Connect your own for personalized results.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="button"
            className="btn btn-secondary bg-gray-700/50 hover:bg-gray-700/70 btn-sm w-full sm:w-auto"
            onClick={() => navigate("/settings")}
          >
            Connect Last.fm
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm hover:bg-gray-700/50 w-full sm:w-auto"
            onClick={() => {
              setDismissed(true);
              sessionStorage.setItem(DISMISS_KEY, "1");
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default LastfmBanner;
