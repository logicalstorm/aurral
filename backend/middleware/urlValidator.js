import net from "net";

const ALWAYS_BLOCKED_HOSTS = new Set(["169.254.169.254"]);

const toIPv4Int = (ip) =>
  ip
    .split(".")
    .map((part) => Number(part))
    .reduce((acc, part) => (acc << 8) + part, 0) >>> 0;

const isPrivateIPv4 = (ip) => {
  const int = toIPv4Int(ip);
  const inRange = (start, end) => int >= start && int <= end;
  return (
    inRange(toIPv4Int("10.0.0.0"), toIPv4Int("10.255.255.255")) ||
    inRange(toIPv4Int("172.16.0.0"), toIPv4Int("172.31.255.255")) ||
    inRange(toIPv4Int("192.168.0.0"), toIPv4Int("192.168.255.255")) ||
    inRange(toIPv4Int("127.0.0.0"), toIPv4Int("127.255.255.255")) ||
    inRange(toIPv4Int("169.254.0.0"), toIPv4Int("169.254.255.255"))
  );
};

const isPrivateIPv6 = (ip) => {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
};

export const validateExternalUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return { valid: false, error: "URL is required" };
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { valid: false, error: "Only HTTP and HTTPS URLs are allowed" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (ALWAYS_BLOCKED_HOSTS.has(hostname)) {
    return { valid: false, error: "Target host is blocked" };
  }
  const allowLocalUrls = process.env.ALLOW_LOCAL_URLS !== "false";
  const ipType = net.isIP(hostname);
  if (!allowLocalUrls) {
    if (hostname === "localhost") {
      return { valid: false, error: "Localhost is not allowed" };
    }
    if (
      (ipType === 4 && isPrivateIPv4(hostname)) ||
      (ipType === 6 && isPrivateIPv6(hostname))
    ) {
      return { valid: false, error: "Private and loopback addresses are not allowed" };
    }
  }
  return { valid: true, url: parsed.toString().replace(/\/+$/, "") };
};
