import { useEffect, useMemo, useRef, useState } from "react";

const UpdateBanner = ({ currentVersion }) => {
  const [updateInfo, setUpdateInfo] = useState(null);
  const updateNotifiedRef = useRef(null);
  const dismissedUpdateRef = useRef(null);
  const resolvedVersion = currentVersion || import.meta.env.VITE_APP_VERSION;
  const dismissKey = useMemo(
    () =>
      `aurral:updateDismissed:${
        import.meta.env.VITE_GITHUB_REPO || "lklynet/aurral"
      }`,
    [],
  );

  useEffect(() => {
    const currentVersion = resolvedVersion;
    const formatSha = (value) => (value ? value.slice(0, 7) : "");
    const isSha = (value) => /^[0-9a-f]{7,40}$/i.test(value || "");
    const normalizeVersion = (value) => (value || "").replace(/^v/, "");
    const repo = import.meta.env.VITE_GITHUB_REPO || "lklynet/aurral";
    if (!currentVersion || currentVersion === "unknown" || !repo) {
      return;
    }
    const currentIsSha = isSha(currentVersion);
    const currentLabel = normalizeVersion(currentVersion);
    let active = true;
    const checkForUpdate = async () => {
      try {
        const isTestChannel = repo === "lklynet/aurral";
        const endpoint = isTestChannel
          ? `https://api.github.com/repos/${repo}/releases?per_page=20`
          : `https://api.github.com/repos/${repo}/releases/latest`;
        const res = await fetch(endpoint);
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        let latestSha = "";
        let latestLabel = "";
        let releaseUrl = `https://github.com/${repo}/releases/latest`;
        if (isTestChannel) {
          const releases = Array.isArray(data) ? data : [];
          const testRelease = releases.find((release) =>
            /-test\.\d+$/.test((release.tag_name || "").replace(/^v/, "")),
          );
          if (!testRelease) {
            return;
          }
          latestSha = (testRelease.target_commitish || "").trim();
          latestLabel = normalizeVersion(testRelease.tag_name || "");
          releaseUrl = testRelease.html_url || releaseUrl;
        } else {
          latestSha = (data.target_commitish || "").trim();
          latestLabel = normalizeVersion(data.tag_name || "");
          releaseUrl = data.html_url || releaseUrl;
        }
        const latestKey = currentIsSha ? latestSha : latestLabel;
        if (!latestKey) {
          return;
        }
        if (
          (currentIsSha && latestSha === currentVersion) ||
          (!currentIsSha && latestLabel === currentLabel)
        ) {
          return;
        }
        const dismissedVersion =
          dismissedUpdateRef.current ??
          localStorage.getItem(dismissKey);
        if (dismissedVersion === latestKey) {
          return;
        }
        if (updateNotifiedRef.current === latestKey) {
          return;
        }
        if (!active) {
          return;
        }
        setUpdateInfo({
          current: currentIsSha ? formatSha(currentVersion) : currentLabel,
          latest: currentIsSha
            ? latestLabel || formatSha(latestSha)
            : latestLabel,
          latestKey,
          url: releaseUrl,
        });
        updateNotifiedRef.current = latestKey;
      } catch {}
    };
    checkForUpdate();
    const intervalId = setInterval(checkForUpdate, 60 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [dismissKey, resolvedVersion]);

  const dismissUpdate = () => {
    if (!updateInfo?.latestKey) {
      return;
    }
    dismissedUpdateRef.current = updateInfo.latestKey;
    localStorage.setItem(dismissKey, updateInfo.latestKey);
    setUpdateInfo(null);
  };

  if (!updateInfo) {
    return null;
  }

  return (
    <div className="mb-6 bg-[#211f27] px-5 py-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-sm uppercase tracking-wide">
            Update available: <span className="text-[#c1c1c3]">{updateInfo.current}</span> → <span className="text-[#90a47a]">{updateInfo.latest}</span>
          </p>
          <p className="text-xs text-[#c1c1c3]">
            A newer build is ready. Update when convenient.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <a
            href={updateInfo.url}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary bg-gray-700/50 hover:bg-gray-700/70 btn-sm w-full sm:w-auto"
          >
            View release
          </a>
          <button
            type="button"
            className="btn btn-ghost btn-sm hover:bg-gray-700/50 w-full sm:w-auto"
            onClick={dismissUpdate}
          >
            Hide until next update
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpdateBanner;
