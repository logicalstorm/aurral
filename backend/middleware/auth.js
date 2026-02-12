import basicAuth from "express-basic-auth";
import bcrypt from "bcrypt";
import { dbOps, userOps } from "../config/db-helpers.js";

const DEFAULT_PROXY_HEADER = "x-forwarded-user";

export const getAuthUser = () => {
  const settings = dbOps.getSettings();
  return (
    settings.integrations?.general?.authUser || process.env.AUTH_USER || "admin"
  );
};

export const getAuthPassword = () => {
  const settings = dbOps.getSettings();
  const dbPass = settings.integrations?.general?.authPassword;
  if (dbPass) return [dbPass];
  return process.env.AUTH_PASSWORD
    ? process.env.AUTH_PASSWORD.split(",").map((p) => p.trim())
    : [];
};

export const isProxyAuthEnabled = () => {
  if (process.env.AUTH_PROXY_ENABLED === "true") return true;
  return !!process.env.AUTH_PROXY_HEADER;
};

function parseCsv(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getProxyHeaderName() {
  const header = process.env.AUTH_PROXY_HEADER || DEFAULT_PROXY_HEADER;
  return String(header).trim().toLowerCase();
}

function getHeaderValue(req, headerName) {
  const value = req.headers[headerName];
  if (Array.isArray(value)) return value[0];
  return value;
}

function isTrustedProxy(req) {
  const allowed = parseCsv(process.env.AUTH_PROXY_TRUSTED_IPS);
  if (allowed.length === 0) return true;
  const ips = Array.isArray(req.ips) && req.ips.length > 0 ? req.ips : [req.ip];
  return ips.some((ip) => allowed.includes(ip));
}

function buildPermissions(role, permissions) {
  if (role === "admin") {
    return {
      accessSettings: true,
      accessFlow: true,
      addArtist: true,
      addAlbum: true,
      changeMonitoring: true,
      deleteArtist: true,
      deleteAlbum: true,
    };
  }
  return {
    ...userOps.getDefaultPermissions(),
    ...(permissions || {}),
    accessSettings: true,
    accessFlow: false,
  };
}

function resolveProxyUser(req) {
  if (!isProxyAuthEnabled()) return null;
  if (!isTrustedProxy(req)) return null;
  const headerName = getProxyHeaderName();
  const rawUsername = getHeaderValue(req, headerName);
  const username = String(rawUsername || "").trim();
  if (!username) return null;
  const existing = userOps.getUserByUsername(username);
  if (existing) {
    return {
      id: existing.id,
      username: existing.username,
      role: existing.role,
      permissions: buildPermissions(existing.role, existing.permissions),
    };
  }
  const adminUsers = parseCsv(process.env.AUTH_PROXY_ADMIN_USERS).map((u) =>
    u.toLowerCase()
  );
  const headerRoleName = process.env.AUTH_PROXY_ROLE_HEADER
    ? String(process.env.AUTH_PROXY_ROLE_HEADER).trim().toLowerCase()
    : "";
  const headerRole = headerRoleName
    ? String(getHeaderValue(req, headerRoleName) || "").trim().toLowerCase()
    : "";
  const defaultRole =
    (process.env.AUTH_PROXY_DEFAULT_ROLE || "user").trim().toLowerCase() ===
    "admin"
      ? "admin"
      : "user";
  const role =
    headerRole === "admin" || adminUsers.includes(username.toLowerCase())
      ? "admin"
      : defaultRole;
  return {
    id: -1,
    username,
    role,
    permissions: buildPermissions(role),
  };
}

function migrateLegacyAdmin() {
  const users = userOps.getAllUsers();
  if (users.length > 0) return;
  const settings = dbOps.getSettings();
  const onboardingComplete = settings.onboardingComplete;
  const authUser = settings.integrations?.general?.authUser || "admin";
  const authPassword = settings.integrations?.general?.authPassword;
  if (!onboardingComplete || !authPassword) return;
  const hash = bcrypt.hashSync(authPassword, 10);
  userOps.createUser(authUser, hash, "admin", null);
}

function resolveUser(username, password) {
  const users = userOps.getAllUsers();
  if (users.length === 0) {
    migrateLegacyAdmin();
  }
  const all = userOps.getAllUsers();
  if (all.length === 0) return null;
  const un = String(username || "")
    .trim()
    .toLowerCase();
  const u = userOps.getUserByUsername(un);
  if (!u || !password) return null;
  const ok = bcrypt.compareSync(password, u.passwordHash);
  if (!ok) return null;
  const perms = buildPermissions(u.role, u.permissions);
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    permissions: perms,
  };
}

function legacyAuth(username, password) {
  const authUser = getAuthUser();
  const passwords = getAuthPassword();
  if (passwords.length === 0) return null;
  const userMatches = basicAuth.safeCompare(username, authUser);
  const passwordMatches = passwords.some((p) =>
    basicAuth.safeCompare(password, p)
  );
  if (!userMatches || !passwordMatches) return null;
  return {
    id: 0,
    username: authUser,
    role: "admin",
    permissions: {
      accessSettings: true,
      accessFlow: true,
      addArtist: true,
      addAlbum: true,
      changeMonitoring: true,
      deleteArtist: true,
      deleteAlbum: true,
    },
  };
}

export function resolveRequestUser(req) {
  const proxyUser = resolveProxyUser(req);
  if (proxyUser) return proxyUser;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) return null;
  try {
    const token = authHeader.substring(6);
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    const username = colon >= 0 ? decoded.slice(0, colon) : decoded;
    const password = colon >= 0 ? decoded.slice(colon + 1) : "";
    let user = resolveUser(username, password);
    if (!user) user = legacyAuth(username, password);
    return user;
  } catch (e) {
    return null;
  }
}

export const createAuthMiddleware = () => {
  return (req, res, next) => {
    if (!req.path.startsWith("/api")) return next();
    if (req.path.startsWith("/api/health")) return next();
    if (req.path.startsWith("/api/onboarding")) return next();
    if (req.path.endsWith("/stream") || req.path.includes("/stream/"))
      return next();

    const settings = dbOps.getSettings();
    const onboardingDone = settings.onboardingComplete;
    const users = userOps.getAllUsers();
    const legacyPasswords = getAuthPassword();
    const authRequired =
      onboardingDone &&
      (isProxyAuthEnabled() || users.length > 0 || legacyPasswords.length > 0);

    if (!authRequired) return next();

    const user = resolveRequestUser(req);
    if (user) {
      req.user = user;
      return next();
    }

    res.setHeader("WWW-Authenticate", 'Basic realm="Aurral"');
    return res
      .status(401)
      .json({ error: "Unauthorized", message: "Authentication required" });
  };
};

function getCredentialsFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Basic ")) {
    try {
      const token = authHeader.substring(6);
      const decoded = Buffer.from(token, "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      const username = colon >= 0 ? decoded.slice(0, colon) : decoded;
      const password = colon >= 0 ? decoded.slice(colon + 1) : "";
      return { username, password };
    } catch (e) {
      return null;
    }
  }
  const token = req.query.token;
  if (token) {
    try {
      const decoded = Buffer.from(decodeURIComponent(token), "base64").toString(
        "utf8"
      );
      const colon = decoded.indexOf(":");
      const username = colon >= 0 ? decoded.slice(0, colon) : decoded;
      const password = colon >= 0 ? decoded.slice(colon + 1) : "";
      return { username, password };
    } catch (e) {
      return null;
    }
  }
  return null;
}

export const verifyTokenAuth = (req) => {
  const user = resolveRequestUser(req);
  if (user) {
    req.user = user;
    return true;
  }
  const creds = getCredentialsFromRequest(req);
  if (creds) {
    let u = resolveUser(creds.username, creds.password);
    if (!u) u = legacyAuth(creds.username, creds.password);
    if (u) {
      req.user = u;
      return true;
    }
  }
  if (isProxyAuthEnabled()) return false;
  const passwords = getAuthPassword();
  if (passwords.length === 0) return true;
  return false;
};

export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return !!user.permissions?.[permission];
}
