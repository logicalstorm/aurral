import basicAuth from "express-basic-auth";
import bcrypt from "bcrypt";
import { dbOps, userOps } from "../config/db-helpers.js";

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
  const perms =
    u.role === "admin"
      ? {
          addArtist: true,
          addAlbum: true,
          changeMonitoring: true,
          deleteArtist: true,
          deleteAlbum: true,
        }
      : { ...userOps.getDefaultPermissions(), ...(u.permissions || {}) };
  if (u.role === "admin") {
    perms.accessSettings = true;
    perms.accessFlow = true;
  } else {
    perms.accessSettings = true;
    perms.accessFlow = false;
  }
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
      onboardingDone && (users.length > 0 || legacyPasswords.length > 0);

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
  const passwords = getAuthPassword();
  if (passwords.length === 0) return true;
  return false;
};

export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return !!user.permissions?.[permission];
}
