import { hasPermission } from "./auth.js";

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res
      .status(401)
      .json({ error: "Unauthorized", message: "Authentication required" });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res
      .status(403)
      .json({ error: "Forbidden", message: "Admin access required" });
  }
  next();
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: "Unauthorized", message: "Authentication required" });
    }
    if (!hasPermission(req.user, permission)) {
      return res
        .status(403)
        .json({
          error: "Forbidden",
          message: `Permission required: ${permission}`,
        });
    }
    next();
  };
}
