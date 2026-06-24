export function OnboardingStep({ centered = false, children }) {
  return (
    <div
      className={`onboarding-step${centered ? " onboarding-step--center" : ""}`}
    >
      {children}
    </div>
  );
}

export function OnboardingStepHeader({
  title,
  titleClassName = "",
  copy,
  centered = false,
}) {
  return (
    <div
      className={`onboarding-step__header${centered ? " onboarding-step__header--center" : ""}`}
    >
      <h2
        className={`onboarding-title${titleClassName ? ` ${titleClassName}` : ""}`}
      >
        {title}
      </h2>
      {copy ? <p className="onboarding-copy">{copy}</p> : null}
    </div>
  );
}

export function OnboardingHint({ children, center = false }) {
  if (!children) return null;
  return (
    <p className={`onboarding-hint${center ? " onboarding-hint--center" : ""}`}>
      {children}
    </p>
  );
}

export function OnboardingFieldGroup({ label, hint, children }) {
  return (
    <div className="onboarding-field-group">
      {label ? <span className="onboarding-label">{label}</span> : null}
      {children}
      {hint ? <OnboardingHint>{hint}</OnboardingHint> : null}
    </div>
  );
}

export const getApiErrorMessage = (error, fallback) =>
  error?.response?.data?.message ||
  error?.response?.data?.error ||
  error?.message ||
  fallback;

export const ONBOARDING_HERO_LOGO_SIZE = 56;
export const ONBOARDING_COMPACT_LOGO_SIZE = 28;

export const STEPS = [
  "welcome",
  "admin",
  "downloads",
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
