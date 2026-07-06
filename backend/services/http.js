function buildAuthHeader(auth) {
  if (!auth?.username && !auth?.password) return null;
  const encoded = Buffer.from(`${auth.username || ""}:${auth.password || ""}`).toString("base64");
  return `Basic ${encoded}`;
}

import { defaultDispatcher } from "../../lib/axiosFetch.js";

async function readResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return response.text();
}

export async function httpRequest(url, { method = "GET", headers = {}, body, timeoutMs = 45000, auth } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const requestHeaders = { ...headers };
  const authHeader = buildAuthHeader(auth);
  if (authHeader) requestHeaders.Authorization = authHeader;
  if (body != null && !requestHeaders["Content-Type"]) {
    requestHeaders["Content-Type"] = "application/json";
  }
  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: controller.signal,
      dispatcher: defaultDispatcher,
    });
    const data = await readResponseBody(response);
    return { status: response.status, data, headers: response.headers, ok: response.ok };
  } finally {
    clearTimeout(timer);
  }
}

export async function httpGet(url, options = {}) {
  return httpRequest(url, { ...options, method: "GET" });
}

export async function httpPost(url, body, options = {}) {
  return httpRequest(url, { ...options, method: "POST", body });
}
