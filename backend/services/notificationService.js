import axios from "axios";
import { dbOps } from "../config/db-helpers.js";

async function sendGotify(title, message, priority = 5) {
  const settings = dbOps.getSettings();
  const gotify = settings.integrations?.gotify || {};
  const url = (gotify.url || "").trim().replace(/\/+$/, "");
  const token = (gotify.token || "").trim();
  if (!url || !token) return;
  const endpoint = `${url}/message?token=${encodeURIComponent(token)}`;
  try {
    await axios.post(
      endpoint,
      { title, message, priority },
      { timeout: 10000, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.warn("[NotificationService] Gotify send failed:", err.message);
  }
}

export async function sendGotifyTest(url, token) {
  const base = (url || "").trim().replace(/\/+$/, "");
  const t = (token || "").trim();
  if (!base || !t) {
    const err = new Error("Gotify URL and token are required");
    err.code = "MISSING_CONFIG";
    throw err;
  }
  const endpoint = `${base}/message?token=${encodeURIComponent(t)}`;
  const response = await axios.post(
    endpoint,
    {
      title: "Aurral – Test",
      message: "This is a test notification from Aurral.",
      priority: 5,
    },
    { timeout: 10000, headers: { "Content-Type": "application/json" } },
  );
  return response.status === 200;
}

export async function notifyDiscoveryUpdated() {
  const settings = dbOps.getSettings();
  const gotify = settings.integrations?.gotify || {};
  if (!gotify.notifyDiscoveryUpdated) return;
  await sendGotify(
    "Aurral – Discover",
    "Daily Discover recommendations have been updated.",
    5,
  );
}

export async function notifyWeeklyFlowDone(playlistType, stats = {}) {
  const settings = dbOps.getSettings();
  const gotify = settings.integrations?.gotify || {};
  if (!gotify.notifyWeeklyFlowDone) return;
  const completed = stats.completed ?? 0;
  const failed = stats.failed ?? 0;
  const parts = [`Weekly flow "${playlistType}" finished processing.`];
  if (completed > 0 || failed > 0) {
    parts.push(`Completed: ${completed}, Failed: ${failed}`);
  }
  await sendGotify("Aurral – Weekly Flow", parts.join(" "), 5);
}
