import path from "path";

const DEFAULT_WEEKLY_FLOW_ROOT = "/app/downloads";

export function resolveWeeklyFlowRoot(explicitRoot) {
  const override = String(explicitRoot ?? "").trim();
  if (override) {
    return path.isAbsolute(override)
      ? override
      : path.resolve(process.cwd(), override);
  }

  const weeklyFlowFolder = String(process.env.WEEKLY_FLOW_FOLDER || "").trim();
  if (weeklyFlowFolder) {
    return path.isAbsolute(weeklyFlowFolder)
      ? weeklyFlowFolder
      : path.resolve(process.cwd(), weeklyFlowFolder);
  }

  const downloadFolder = String(process.env.DOWNLOAD_FOLDER || "").trim();
  if (path.isAbsolute(downloadFolder)) {
    return downloadFolder;
  }

  return DEFAULT_WEEKLY_FLOW_ROOT;
}
