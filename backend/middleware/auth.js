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
    if (req.path === "/api/health") return next();
    // Skip auth for streaming endpoints (they handle auth manually via token query param)
    if (req.path.endsWith("/stream")) return next();
    return auth(req, res, next);
  };
};
