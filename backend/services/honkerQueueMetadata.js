export const QUEUE_DEFINITIONS = [
  {
    queue: "system-task",
    label: "System Maintenance",
    workerLabel: "System Maintenance Worker",
    description: "Runs housekeeping, startup checks, and scheduled playlist maintenance.",
    worker: "system-task",
  },
  {
    queue: "weekly-flow-operation",
    label: "Playlist Operations",
    workerLabel: "Playlist Operation Worker",
    description: "Applies playlist edits, manual runs, flow changes, and track actions.",
    worker: "weekly-flow-operation",
  },
  {
    queue: "slskd-pipeline",
    label: "Download Pipeline",
    workerLabel: "Download Pipeline Worker",
    description: "Searches, downloads, validates, and finalizes playlist tracks.",
    worker: "slskd-pipeline",
  },
  {
    queue: "playlist-retry",
    label: "Playlist Retry",
    workerLabel: "Playlist Retry Worker",
    description: "Retries incomplete playlist tracks after temporary download failures.",
    worker: "playlist-retry",
  },
  {
    queue: "playlist-reserve-build",
    label: "Reserve Playlist Builds",
    workerLabel: "Reserve Playlist Builder",
    description: "Builds backup candidate tracks for playlists before they are needed.",
    worker: "playlist-reserve-build",
  },
  {
    queue: "playlist-mbid-enrichment",
    label: "Playlist MBID Enrichment",
    workerLabel: "Playlist MBID Worker",
    description: "Finds and fills missing MusicBrainz IDs on imported playlist tracks.",
    worker: "playlist-mbid-enrichment",
  },
  {
    queue: "library-scan",
    label: "Library Scans",
    workerLabel: "Library Scan Worker",
    description: "Refreshes Aurral's view of files after playlist or library changes.",
    worker: "library-scan",
  },
  {
    queue: "discovery-refresh",
    label: "Discovery Refreshes",
    workerLabel: "Discovery Refresh Worker",
    description: "Refreshes discovery recommendations from library and listening data.",
    worker: "discovery-refresh",
  },
  {
    queue: "discovery-playlist-build",
    label: "Discovery Playlist Builds",
    workerLabel: "Discovery Playlist Builder",
    description: "Creates generated discovery playlists in the background.",
    worker: "discovery-playlist-build",
  },
  {
    queue: "discovery-user-refresh",
    label: "Listening History Refreshes",
    workerLabel: "Listening History Worker",
    description: "Refreshes user listening profiles used by discovery.",
    worker: "discovery-user-refresh",
  },
  {
    queue: "image-prefetch",
    label: "Image Prefetch",
    workerLabel: "Image Prefetch Worker",
    description: "Warms artist and playlist artwork so pages load faster.",
    worker: "image-prefetch",
  },
  {
    queue: "_outbox:notifications",
    label: "Notifications",
    workerLabel: "Notification Worker",
    description: "Delivers queued Gotify and webhook notifications.",
    worker: "notification-outbox",
  },
];

export const SYSTEM_TASK_LABELS = {
  "weekly-flow-refresh": {
    label: "Playlist Schedule Check",
    description: "Queues enabled playlist flows that are due to run.",
  },
  "session-cleanup": {
    label: "Session Cleanup",
    description: "Removes expired login sessions from the app database.",
  },
  "weekly-flow-reuse-repair": {
    label: "Playlist File Reuse Repair",
    description: "Repairs reusable playlist file links when source files move.",
  },
  "weekly-flow-startup-reuse-repair": {
    label: "Startup Playlist Reuse Repair",
    description: "Checks reusable playlist links after Aurral starts.",
  },
  "weekly-flow-startup-check": {
    label: "Startup Playlist Schedule Check",
    description: "Resumes pending playlist work after Aurral starts.",
  },
  "discovery-refresh-check": {
    label: "Discovery Auto Refresh Check",
    description: "Checks whether discovery recommendations need a scheduled refresh.",
  },
  "discovery-bootstrap": {
    label: "Discovery Startup Check",
    description: "Initializes discovery data and schedules the next refresh.",
  },
  "playlist-startup-migration": {
    label: "Playlist Startup Migration",
    description: "Migrates legacy playlist files and reconciles playlist folders.",
  },
  "lidarr-retry": {
    label: "Lidarr Retry",
    description: "Retries Lidarr library access after a temporary connection problem.",
  },
};

export const HONKER_QUEUE_NAMES = QUEUE_DEFINITIONS.map((definition) => definition.queue);
