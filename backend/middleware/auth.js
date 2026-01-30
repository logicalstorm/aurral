import basicAuth from "express-basic-auth";
import { dbOps } from "../config/db-helpers.js";

export const getAuthUser = () => {
  const settings = dbOps.getSettings();
  return settings.integrations?.general?.authUser || process.env.AUTH_USER || "admin";
};

export const getAuthPassword = () => {
  const settings = dbOps.getSettings();
  const dbPass = settings.integrations?.general?.authPassword;
  if (dbPass) return [dbPass];
  return process.env.AUTH_PASSWORD ? process.env.AUTH_PASSWORD.split(",").map(p => p.trim()) : [];
};

export const createAuthMiddleware = () => {
  const passwords = getAuthPassword();
  if (passwords.length === 0) {
    return (req, res, next) => next();
  }

  const auth = basicAuth({
    authorizer: (username, password) => {
      const userMatches = basicAuth.safeCompare(username, getAuthUser());
      const passwordMatches = passwords.some((p) =>
        basicAuth.safeCompare(password, p),
      );
      return userMatches && passwordMatches;
    },
    challenge: false,
  });

  return (req, res, next) => {
    if (!req.path.startsWith("/api")) return next();
    if (req.path === "/api/health") return next();
    if (req.path.startsWith("/api/onboarding")) return next();
    if (req.path.endsWith("/stream") || req.path.includes("/stream/")) return next();
    return auth(req, res, next);
  };
};

export const verifyTokenAuth = (req) => {
  const passwords = getAuthPassword();
  if (passwords.length === 0) return true;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Basic ")) {
    const token = authHeader.substring(6);
    try {
      const [username, password] = atob(token).split(":");
      if (username === getAuthUser() && passwords.some((p) => basicAuth.safeCompare(password, p))) return true;
    } catch (e) {}
  }
  const token = req.query.token;
  if (token) {
    try {
      const [username, password] = atob(decodeURIComponent(token)).split(":");
      if (username === getAuthUser() && passwords.some((p) => basicAuth.safeCompare(password, p))) return true;
    } catch (e) {}
  }
  return false;
};
