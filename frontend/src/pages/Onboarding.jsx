import { useCallback, useEffect, useState } from "react";
import { ChevronRight, ChevronLeft, CheckCircle2 } from "lucide-react";
import {
  applyLidarrCommunityGuideOnboarding,
  completeOnboarding,
  getLidarrMetadataProfilesOnboarding,
  getLidarrProfilesOnboarding,
  testLidarrLibraryAccessOnboarding,
  testLidarrOnboarding,
  testNavidromeOnboarding,
  testSlskdOnboarding,
} from "../utils/api";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { LidarrLibraryAccessCheck } from "./Settings/components/LidarrLibraryAccessCheck";
import { CommunityGuideModal } from "./Settings/components/CommunityGuideModal";

const getApiErrorMessage = (error, fallback) =>
  error?.response?.data?.message ||
  error?.response?.data?.error ||
  error?.message ||
  fallback;

const STEPS = [
  "welcome",
  "admin",
  "lidarr-connect",
  "lidarr-library",
  "lidarr-davo",
  "lidarr-preferences",
  "navidrome",
  "lastfm",
  "slskd",
  "ticketmaster",
  "brainzmash",
];

function Onboarding() {
  useDocumentTitle("Setup");
  const [step, setStep] = useState(0);
  const [authUser, setAuthUser] = useState("admin");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("");
  const [lidarrUrl, setLidarrUrl] = useState("");
  const [lidarrApiKey, setLidarrApiKey] = useState("");
  const [lidarrQualityProfileId, setLidarrQualityProfileId] = useState("");
  const [lidarrMetadataProfileId, setLidarrMetadataProfileId] = useState("");
  const [lidarrDefaultMonitorOption, setLidarrDefaultMonitorOption] =
    useState("none");
  const [lidarrSearchOnAdd, setLidarrSearchOnAdd] = useState(false);
  const [lidarrProfiles, setLidarrProfiles] = useState([]);
  const [lidarrMetadataProfiles, setLidarrMetadataProfiles] = useState([]);
  const [loadingLidarrProfiles, setLoadingLidarrProfiles] = useState(false);
  const [navidromeUrl, setNavidromeUrl] = useState("");
  const [navidromeUsername, setNavidromeUsername] = useState("");
  const [navidromePassword, setNavidromePassword] = useState("");
  const [lastfmUsername, setLastfmUsername] = useState("");
  const [lastfmApiKey, setLastfmApiKey] = useState("");
  const [slskdUrl, setSlskdUrl] = useState("");
  const [slskdApiKey, setSlskdApiKey] = useState("");
  const [ticketmasterApiKey, setTicketmasterApiKey] = useState("");
  const [lidarrTestSuccess, setLidarrTestSuccess] = useState(false);
  const [testingLidarr, setTestingLidarr] = useState(false);
  const [testingLidarrLibraryAccess, setTestingLidarrLibraryAccess] =
    useState(false);
  const [lidarrLibraryAccessResult, setLidarrLibraryAccessResult] =
    useState(null);
  const [showCommunityGuideModal, setShowCommunityGuideModal] = useState(false);
  const [applyingCommunityGuide, setApplyingCommunityGuide] = useState(false);
  const [davoApplied, setDavoApplied] = useState(false);
  const [navidromeTestSuccess, setNavidromeTestSuccess] = useState(false);
  const [testingNavidrome, setTestingNavidrome] = useState(false);
  const [slskdTestSuccess, setSlskdTestSuccess] = useState(false);
  const [testingSlskd, setTestingSlskd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { refreshAuth } = useAuth();
  const { showSuccess, showInfo } = useToast();

  const currentStep = STEPS[step];
  const hasNavidrome =
    navidromeUrl.trim() && navidromeUsername.trim() && navidromePassword;
  const hasLastfm = !!lastfmUsername.trim() && !!lastfmApiKey.trim();
  const hasSlskd = !!slskdUrl.trim() && !!slskdApiKey.trim();
  const hasTicketmaster = !!ticketmasterApiKey.trim();
  const passwordTooShort = authPassword.length > 0 && authPassword.length < 8;
  const adminComplete =
    authUser.trim() &&
    authPassword &&
    !passwordTooShort &&
    authPassword === authPasswordConfirm;
  const lidarrPreferencesComplete =
    !!lidarrQualityProfileId && !!lidarrMetadataProfileId;

  const loadLidarrProfiles = useCallback(async () => {
    if (!lidarrUrl.trim() || !lidarrApiKey.trim()) return;
    setLoadingLidarrProfiles(true);
    try {
      const [profiles, metadataProfiles] = await Promise.all([
        getLidarrProfilesOnboarding(lidarrUrl.trim(), lidarrApiKey.trim()),
        getLidarrMetadataProfilesOnboarding(
          lidarrUrl.trim(),
          lidarrApiKey.trim(),
        ),
      ]);
      setLidarrProfiles(Array.isArray(profiles) ? profiles : []);
      setLidarrMetadataProfiles(
        Array.isArray(metadataProfiles) ? metadataProfiles : [],
      );
    } catch (e) {
      setError(getApiErrorMessage(e, "Failed to load Lidarr profiles"));
    } finally {
      setLoadingLidarrProfiles(false);
    }
  }, [lidarrApiKey, lidarrUrl]);

  useEffect(() => {
    if (currentStep !== "lidarr-preferences" || !lidarrTestSuccess) return;
    loadLidarrProfiles();
  }, [currentStep, lidarrTestSuccess, loadLidarrProfiles]);

  const handleNext = () => {
    setError("");
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  const handleBack = () => {
    setError("");
    if (step > 0) setStep(step - 1);
  };

  const handleTestLidarr = async () => {
    if (!lidarrUrl.trim() || !lidarrApiKey.trim()) {
      setError("Enter Lidarr URL and API key first");
      return;
    }
    setTestingLidarr(true);
    setError("");
    try {
      await testLidarrOnboarding(lidarrUrl.trim(), lidarrApiKey.trim());
      setLidarrTestSuccess(true);
      showSuccess("Lidarr connection successful");
    } catch (e) {
      setError(getApiErrorMessage(e, "Connection failed"));
    } finally {
      setTestingLidarr(false);
    }
  };

  const handleLidarrConnectAction = async () => {
    if (lidarrTestSuccess) {
      handleNext();
      return;
    }
    await handleTestLidarr();
  };

  const handleTestLidarrLibraryAccess = async () => {
    if (!lidarrUrl.trim() || !lidarrApiKey.trim()) {
      setError("Enter Lidarr URL and API key first");
      return;
    }
    setTestingLidarrLibraryAccess(true);
    setLidarrLibraryAccessResult(null);
    setError("");
    try {
      const result = await testLidarrLibraryAccessOnboarding(
        lidarrUrl.trim(),
        lidarrApiKey.trim(),
      );
      setLidarrLibraryAccessResult(result);
      if (result.ok) {
        showSuccess("Library access check passed");
      } else {
        setError("Library access check failed. See the results below.");
      }
    } catch (e) {
      setError(getApiErrorMessage(e, "Library access check failed"));
    } finally {
      setTestingLidarrLibraryAccess(false);
    }
  };

  const handleApplyCommunityGuide = async () => {
    setShowCommunityGuideModal(false);
    setApplyingCommunityGuide(true);
    setError("");
    try {
      const result = await applyLidarrCommunityGuideOnboarding(
        lidarrUrl.trim(),
        lidarrApiKey.trim(),
      );
      setDavoApplied(true);
      showSuccess("Community guide settings applied successfully");
      if (result.results?.qualityProfile?.id) {
        setLidarrQualityProfileId(String(result.results.qualityProfile.id));
      }
      if (result.results?.metadataProfile?.id) {
        setLidarrMetadataProfileId(String(result.results.metadataProfile.id));
      }
      await loadLidarrProfiles();
      if (result.results?.qualityProfile?.name) {
        showInfo(
          `Default quality profile set to '${result.results.qualityProfile.name}'`,
        );
      }
    } catch (e) {
      setError(getApiErrorMessage(e, "Failed to apply community guide"));
    } finally {
      setApplyingCommunityGuide(false);
    }
  };

  const handleTestNavidrome = async () => {
    if (!hasNavidrome) return;
    setTestingNavidrome(true);
    setError("");
    try {
      await testNavidromeOnboarding(
        navidromeUrl.trim(),
        navidromeUsername.trim(),
        navidromePassword,
      );
      setNavidromeTestSuccess(true);
      showSuccess("Navidrome connection successful");
    } catch (e) {
      setError(getApiErrorMessage(e, "Connection failed"));
    } finally {
      setTestingNavidrome(false);
    }
  };

  const handleNavidromeStepAction = async () => {
    if (!hasNavidrome) {
      handleNext();
      return;
    }
    if (navidromeTestSuccess) {
      handleNext();
      return;
    }
    await handleTestNavidrome();
  };

  const handleTestSlskd = async () => {
    if (!hasSlskd) return;
    setTestingSlskd(true);
    setError("");
    try {
      const result = await testSlskdOnboarding(
        slskdUrl.trim(),
        slskdApiKey.trim(),
      );
      setSlskdTestSuccess(true);
      if (result.warning || result.soulseekConnected === false) {
        showInfo(
          result.message ||
            "slskd API is reachable, but Soulseek is not connected",
        );
      } else {
        showSuccess(result.message || "slskd connection successful");
      }
    } catch (e) {
      setError(getApiErrorMessage(e, "Connection failed"));
    } finally {
      setTestingSlskd(false);
    }
  };

  const handleSlskdStepAction = async () => {
    if (!hasSlskd) {
      handleNext();
      return;
    }
    if (slskdTestSuccess) {
      handleNext();
      return;
    }
    await handleTestSlskd();
  };

  const handleFinish = async () => {
    setSubmitting(true);
    setError("");
    try {
      await completeOnboarding({
        authUser: authUser.trim() || "admin",
        authPassword: authPassword || undefined,
        lidarr:
          lidarrUrl.trim() && lidarrApiKey.trim()
            ? {
                url: lidarrUrl.trim().replace(/\/+$/, ""),
                apiKey: lidarrApiKey.trim(),
                qualityProfileId: lidarrQualityProfileId
                  ? parseInt(lidarrQualityProfileId, 10)
                  : null,
                metadataProfileId: lidarrMetadataProfileId
                  ? parseInt(lidarrMetadataProfileId, 10)
                  : null,
                defaultMonitorOption: lidarrDefaultMonitorOption,
                searchOnAdd: lidarrSearchOnAdd,
              }
            : undefined,
        navidrome:
          navidromeUrl.trim() && navidromeUsername.trim() && navidromePassword
            ? {
                url: navidromeUrl.trim().replace(/\/+$/, ""),
                username: navidromeUsername.trim(),
                password: navidromePassword,
              }
            : undefined,
        lastfm:
          lastfmUsername.trim() && lastfmApiKey.trim()
            ? {
                username: lastfmUsername.trim(),
                apiKey: lastfmApiKey.trim(),
              }
            : undefined,
        slskd:
          slskdUrl.trim() && slskdApiKey.trim()
            ? {
                url: slskdUrl.trim().replace(/\/+$/, ""),
                apiKey: slskdApiKey.trim(),
              }
            : undefined,
        ticketmaster: hasTicketmaster
          ? { apiKey: ticketmasterApiKey.trim() }
          : undefined,
      });
      await refreshAuth();
      showSuccess("Setup complete. Sign in with your admin account.");
    } catch (e) {
      setError(getApiErrorMessage(e, "Failed to save"));
    } finally {
      setSubmitting(false);
    }
  };

  const isPrimaryDisabled = (() => {
    if (currentStep === "brainzmash") return submitting;
    if (currentStep === "admin") return !adminComplete;
    if (currentStep === "lidarr-connect") {
      return (
        !lidarrTestSuccess &&
        (!lidarrUrl.trim() || !lidarrApiKey.trim() || testingLidarr)
      );
    }
    if (currentStep === "lidarr-library") {
      return testingLidarrLibraryAccess;
    }
    if (currentStep === "lidarr-davo") {
      return applyingCommunityGuide;
    }
    if (currentStep === "lidarr-preferences") {
      return !lidarrPreferencesComplete || loadingLidarrProfiles;
    }
    if (currentStep === "navidrome") return testingNavidrome;
    if (currentStep === "slskd") return testingSlskd;
    return false;
  })();

  const primaryAction = (() => {
    if (currentStep === "brainzmash") return handleFinish;
    if (currentStep === "lidarr-connect") return handleLidarrConnectAction;
    if (currentStep === "navidrome") return handleNavidromeStepAction;
    if (currentStep === "slskd") return handleSlskdStepAction;
    return handleNext;
  })();

  const primaryLabel = (() => {
    if (currentStep === "brainzmash") {
      return submitting ? "Saving…" : "Go to Aurral";
    }
    if (currentStep === "welcome") return "Get started";
    if (currentStep === "lidarr-connect") {
      if (lidarrTestSuccess) {
        return "Next";
      }
      return testingLidarr ? "Testing…" : "Test connection";
    }
    if (currentStep === "lidarr-library") {
      return lidarrLibraryAccessResult?.ok ? "Next" : "Skip for now";
    }
    if (currentStep === "lidarr-davo") {
      return davoApplied ? "Next" : "Skip for now";
    }
    if (currentStep === "navidrome") {
      if (!hasNavidrome) return "Skip";
      if (navidromeTestSuccess) return "Next";
      return testingNavidrome ? "Testing…" : "Test connection";
    }
    if (currentStep === "lastfm") {
      return hasLastfm ? "Next" : "Skip";
    }
    if (currentStep === "slskd") {
      if (!hasSlskd) return "Skip";
      if (slskdTestSuccess) return "Next";
      return testingSlskd ? "Testing…" : "Test connection";
    }
    if (currentStep === "ticketmaster") {
      return hasTicketmaster ? "Next" : "Skip";
    }
    return "Next";
  })();

  return (
    <div className="onboarding-page">
      <CommunityGuideModal
        show={showCommunityGuideModal}
        onClose={() => setShowCommunityGuideModal(false)}
        onApply={handleApplyCommunityGuide}
      />
      <form
        autoComplete="off"
        onSubmit={(e) => e.preventDefault()}
        className="onboarding-card"
      >
        <div className="onboarding-progress">
          <div className="onboarding-progress__dots">
            {STEPS.slice(0, -1).map((s, i) => (
              <div
                key={s}
                className="onboarding-progress__dot"
                style={{
                  backgroundColor:
                    i <= step ? "var(--aurral-green)" : "var(--aurral-gray)",
                }}
              />
            ))}
          </div>
          <span className="onboarding-progress__count">
            {step + 1} / {STEPS.length}
          </span>
        </div>

        {currentStep === "welcome" && (
          <div className="onboarding-step-center">
            <img
              src="/arralogo.svg"
              alt="Aurral Logo"
              className="onboarding-logo"
              style={{
                filter:
                  "brightness(0) saturate(100%) invert(45%) sepia(8%) saturate(800%) hue-rotate(60deg) brightness(95%) contrast(85%)",
              }}
            />
            <h2 className="onboarding-title onboarding-title--hero">
              Welcome to Aurral
            </h2>
            <p className="onboarding-copy onboarding-copy--center">
              Let&apos;s set up your admin account and connect services.
            </p>
          </div>
        )}

        {currentStep === "admin" && (
          <>
            <div className="onboarding-title-row">
              <h2 className="onboarding-title">Admin account</h2>
            </div>
            <p className="onboarding-copy">
              Create a local account to sign in to Aurral.
            </p>
            <div className="onboarding-fields">
              <input
                type="text"
                autoComplete="off"
                className="onboarding-input"
                placeholder="Username"
                value={authUser}
                onChange={(e) => setAuthUser(e.target.value)}
              />
              <input
                type="password"
                autoComplete="new-password"
                className="onboarding-input"
                placeholder="Password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
              <input
                type="password"
                autoComplete="new-password"
                className="onboarding-input"
                placeholder="Confirm password"
                value={authPasswordConfirm}
                onChange={(e) => setAuthPasswordConfirm(e.target.value)}
              />
              <p className="onboarding-copy onboarding-copy--xs">
                Password must be at least 8 characters long.
              </p>
            </div>
          </>
        )}

        {currentStep === "lidarr-connect" && (
          <>
            <div className="onboarding-title-row">
              <h2 className="onboarding-title">Connect Lidarr</h2>
            </div>
            <p className="onboarding-copy">
              Aurral uses Lidarr to manage your music library and downloads.
            </p>
            <div className="onboarding-fields">
              <input
                type="url"
                autoComplete="off"
                className="onboarding-input"
                placeholder="Lidarr URL (e.g. http://localhost:8686)"
                value={lidarrUrl}
                onChange={(e) => {
                  setLidarrUrl(e.target.value);
                  setLidarrTestSuccess(false);
                  setLidarrLibraryAccessResult(null);
                  setLidarrQualityProfileId("");
                  setLidarrMetadataProfileId("");
                  setDavoApplied(false);
                }}
              />
              <input
                type="password"
                autoComplete="off"
                className="onboarding-input"
                placeholder="API key"
                value={lidarrApiKey}
                onChange={(e) => {
                  setLidarrApiKey(e.target.value);
                  setLidarrTestSuccess(false);
                  setLidarrLibraryAccessResult(null);
                  setLidarrQualityProfileId("");
                  setLidarrMetadataProfileId("");
                  setDavoApplied(false);
                }}
              />
              <p className="onboarding-copy onboarding-copy--xs">
                Find your API key in Lidarr under Settings → General → Security.
              </p>
            </div>
          </>
        )}

        {currentStep === "lidarr-library" && (
          <>
            <div className="onboarding-title-row">
              <h2 className="onboarding-title">Library access</h2>
            </div>
            <p className="onboarding-copy">
              Verify we can read files from Lidarr&apos;s library paths for
              playback and playlist reuse.
            </p>
            <div className="onboarding-fields">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleTestLidarrLibraryAccess}
                disabled={
                  testingLidarrLibraryAccess ||
                  !lidarrUrl.trim() ||
                  !lidarrApiKey.trim()
                }
              >
                {testingLidarrLibraryAccess
                  ? "Checking library access..."
                  : "Test library access"}
              </button>
              <LidarrLibraryAccessCheck result={lidarrLibraryAccessResult} />
            </div>
          </>
        )}

        {currentStep === "lidarr-davo" && (
          <>
            <div className="onboarding-title-row">
              <h2 className="onboarding-title">Recommended Lidarr settings</h2>
            </div>
            <p className="onboarding-copy">
              Optionally apply Davo&apos;s Community Lidarr Guide settings. This
              creates an Aurral-friendly quality profile, custom formats, and
              naming scheme.
            </p>
            <div className="onboarding-fields">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowCommunityGuideModal(true)}
                disabled={applyingCommunityGuide}
              >
                {applyingCommunityGuide
                  ? "Applying..."
                  : "Apply Davo's Recommended Settings"}
              </button>
              <p className="onboarding-copy onboarding-copy--xs">
                <a
                  href="https://wiki.servarr.com/lidarr/community-guide"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="settings-page__link"
                >
                  Read the full Community Lidarr Guide
                </a>{" "}
                for naming, custom formats, and profile details.
              </p>
              {davoApplied && (
                <p className="onboarding-copy onboarding-copy--xs">
                  Community guide settings were applied successfully.
                </p>
              )}
            </div>
          </>
        )}

        {currentStep === "lidarr-preferences" && (
          <>
            <div className="onboarding-title-row">
              <h2 className="onboarding-title">Lidarr defaults</h2>
            </div>
            <p className="onboarding-copy">
              Choose the profiles Aurral uses when adding artists and albums.
            </p>
            <div className="onboarding-fields">
              <div>
                <label className="onboarding-label">
                  Default quality profile
                </label>
                <select
                  className="onboarding-input"
                  value={lidarrQualityProfileId}
                  onChange={(e) => setLidarrQualityProfileId(e.target.value)}
                  disabled={loadingLidarrProfiles}
                >
                  <option value="">
                    {loadingLidarrProfiles
                      ? "Loading profiles..."
                      : lidarrProfiles.length === 0
                        ? "No profiles available"
                        : "Select a profile"}
                  </option>
                  {lidarrProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="onboarding-label">
                  Default metadata profile
                </label>
                <select
                  className="onboarding-input"
                  value={lidarrMetadataProfileId}
                  onChange={(e) => setLidarrMetadataProfileId(e.target.value)}
                  disabled={loadingLidarrProfiles}
                >
                  <option value="">
                    {loadingLidarrProfiles
                      ? "Loading profiles..."
                      : lidarrMetadataProfiles.length === 0
                        ? "No profiles available"
                        : "Select a profile"}
                  </option>
                  {lidarrMetadataProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="onboarding-label">
                  Default monitoring option
                </label>
                <select
                  className="onboarding-input"
                  value={lidarrDefaultMonitorOption}
                  onChange={(e) =>
                    setLidarrDefaultMonitorOption(e.target.value)
                  }
                >
                  <option value="none">None (Artist Only)</option>
                  <option value="existing">Existing Albums</option>
                  <option value="all">All Albums</option>
                  <option value="future">Future Albums</option>
                  <option value="missing">Missing Albums</option>
                  <option value="latest">Latest Album</option>
                  <option value="first">First Album</option>
                </select>
                <p className="onboarding-copy onboarding-copy--xs">
                  Aurral uses a pick-and-choose album workflow. We recommend
                  None (Artist Only) so new artists are not fully monitored
                  automatically.
                </p>
              </div>
              <label className="onboarding-checkbox-row">
                <input
                  type="checkbox"
                  className="artist-checkbox"
                  checked={lidarrSearchOnAdd}
                  onChange={(e) => setLidarrSearchOnAdd(e.target.checked)}
                />
                <span>Search on add</span>
              </label>
              <p className="onboarding-copy onboarding-copy--xs">
                When enabled, Lidarr searches for albums as soon as they are
                added. Aurral usually triggers searches when you request
                specific albums, so leaving this off is fine.
              </p>
            </div>
          </>
        )}

        {currentStep === "navidrome" && (
          <>
            <div className="onboarding-title-row">
              <h2 className="onboarding-title">Navidrome (optional)</h2>
            </div>
            <p className="onboarding-copy">
              Recommended for streaming and playlists. Leave blank to skip and
              add later in settings.
            </p>
            <div className="onboarding-fields">
              <input
                type="url"
                autoComplete="off"
                className="onboarding-input"
                placeholder="Navidrome URL"
                value={navidromeUrl}
                onChange={(e) => {
                  setNavidromeUrl(e.target.value);
                  setNavidromeTestSuccess(false);
                }}
              />
              <input
                type="text"
                autoComplete="off"
                className="onboarding-input"
                placeholder="Username"
                value={navidromeUsername}
                onChange={(e) => {
                  setNavidromeUsername(e.target.value);
                  setNavidromeTestSuccess(false);
                }}
              />
              <input
                type="password"
                autoComplete="off"
                className="onboarding-input"
                placeholder="Password"
                value={navidromePassword}
                onChange={(e) => {
                  setNavidromePassword(e.target.value);
                  setNavidromeTestSuccess(false);
                }}
              />
            </div>
          </>
        )}

        {currentStep === "lastfm" && (
          <>
            <div className="onboarding-title-row">
              <h2 className="onboarding-title">Last.fm (optional)</h2>
            </div>
            <p className="onboarding-copy">
              Recommended for personalized discovery, related artists, full tag
              search, and flows. If you skip it, Discover will use ListenBrainz
              trending artists and default genre shelves.
            </p>
            <div className="onboarding-fields">
              <input
                type="text"
                autoComplete="off"
                className="onboarding-input"
                placeholder="Last.fm username"
                value={lastfmUsername}
                onChange={(e) => setLastfmUsername(e.target.value)}
              />
              <input
                type="password"
                autoComplete="off"
                className="onboarding-input"
                placeholder="Last.fm API key"
                value={lastfmApiKey}
                onChange={(e) => setLastfmApiKey(e.target.value)}
              />
            </div>
          </>
        )}

        {currentStep === "slskd" && (
          <>
            <div className="onboarding-title-row">
              <h2 className="onboarding-title">slskd (optional)</h2>
            </div>
            <p className="onboarding-copy">
              Recommended for Soulseek-based downloads in flows and playlists.
              Leave blank to skip and add later in settings.
            </p>
            <div className="onboarding-fields">
              <input
                type="url"
                autoComplete="off"
                className="onboarding-input"
                placeholder="slskd URL (e.g. http://localhost:5030)"
                value={slskdUrl}
                onChange={(e) => {
                  setSlskdUrl(e.target.value);
                  setSlskdTestSuccess(false);
                }}
              />
              <input
                type="password"
                autoComplete="off"
                className="onboarding-input"
                placeholder="API key"
                value={slskdApiKey}
                onChange={(e) => {
                  setSlskdApiKey(e.target.value);
                  setSlskdTestSuccess(false);
                }}
              />
            </div>
          </>
        )}

        {currentStep === "ticketmaster" && (
          <>
            <div className="onboarding-title-row">
              <h2 className="onboarding-title">Ticketmaster (optional)</h2>
            </div>
            <p className="onboarding-copy">
              Recommended for nearby shows on the Discover page.
            </p>
            <div className="onboarding-fields">
              <div className="onboarding-callout">
                <p>
                  Register on the{" "}
                  <a
                    href="https://developer-acct.ticketmaster.com/user/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-page__link"
                  >
                    Ticketmaster developer portal
                  </a>{" "}
                  to get a Consumer Key used for authentication.
                </p>
              </div>
              <input
                type="password"
                autoComplete="off"
                className="onboarding-input"
                placeholder="Consumer key"
                value={ticketmasterApiKey}
                onChange={(e) => setTicketmasterApiKey(e.target.value)}
              />
            </div>
          </>
        )}

        {currentStep === "brainzmash" && (
          <div className="onboarding-step-center">
            <CheckCircle2 className="onboarding-success-icon" />
            <h2 className="onboarding-title">Powered by BrainzMash</h2>
            <p className="onboarding-copy onboarding-copy--center">
              Aurral uses BrainzMash as its metadata provider for artist and
              album discovery, cover art, and Lidarr-compatible metadata.
            </p>
            <p className="onboarding-copy onboarding-copy--center">
              Special thanks to the BrainzMash team for the open-source work
              behind that experience. If Aurral has been useful, consider
              checking out the project, starring the repo, and joining the
              community.
            </p>
            <p className="onboarding-copy onboarding-copy--center">
              <a
                href="https://github.com/statichum/brainzmash-hearring-aid"
                target="_blank"
                rel="noopener noreferrer"
                className="settings-page__link"
              >
                statichum/brainzmash-hearring-aid
              </a>
            </p>
            <p className="onboarding-copy onboarding-copy--xs onboarding-copy--center">
              Finish setup to sign in with your admin account and open Aurral.
            </p>
          </div>
        )}

        {error && <p className="onboarding-error">{error}</p>}

        <div className="onboarding-actions">
          {step > 0 && currentStep !== "brainzmash" && (
            <button
              type="button"
              onClick={handleBack}
              className="btn btn-secondary btn-sm btn--bold"
            >
              <ChevronLeft className="artist-icon-xs" />
              Back
            </button>
          )}
          <button
            type="button"
            onClick={primaryAction}
            disabled={isPrimaryDisabled}
            className={`btn btn-sm btn--bold btn--grow${isPrimaryDisabled ? " btn-secondary" : " btn-primary"}`}
          >
            {primaryLabel === "Next" || primaryLabel === "Skip" ? (
              <>
                {primaryLabel}
                {primaryLabel === "Next" && (
                  <ChevronRight className="artist-icon-xs" />
                )}
              </>
            ) : (
              primaryLabel
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default Onboarding;
