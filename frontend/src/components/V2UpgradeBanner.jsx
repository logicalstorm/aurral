import { useState } from "react";

const DISMISS_KEY = "aurral:v2-upgrade-warning-dismissed";

const V2UpgradeBanner = () => {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) {
    return null;
  }

  return (
    <div className="mb-6 border border-amber-400/40 bg-amber-500/15 px-5 py-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-amber-200">
            Aurral v2 is coming
          </p>
          <p className="text-sm text-[#e8e4dc]">
            The next major release is a big upgrade. Aurral&apos;s built-in Soulseek client is
            being removed in favor of external{" "}
            <a
              href="https://github.com/slskd/slskd"
              target="_blank"
              rel="noreferrer"
              className="text-amber-200 underline underline-offset-2 hover:text-amber-100"
            >
              slskd
            </a>{" "}
            for more reliable flow and playlist downloads.
          </p>
          <p className="text-xs text-[#c1c1c3]">
            Want to stay on Aurral 1.x for now? Pin your Docker image to a{" "}
            <code className="rounded bg-black/20 px-1 py-0.5 text-[11px]">1.x.x</code> tag instead
            of <code className="rounded bg-black/20 px-1 py-0.5 text-[11px]">latest</code> before
            you update.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <a
            href="https://github.com/lklynet/aurral#pinning-to-aurral-1x"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary bg-gray-700/50 hover:bg-gray-700/70 btn-sm w-full sm:w-auto"
          >
            Pinning guide
          </a>
          <button
            type="button"
            className="btn btn-ghost btn-sm hover:bg-gray-700/50 w-full sm:w-auto"
            onClick={() => {
              setDismissed(true);
              try {
                localStorage.setItem(DISMISS_KEY, "1");
              } catch {}
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default V2UpgradeBanner;
