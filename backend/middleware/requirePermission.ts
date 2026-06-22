import type { Request, Response, NextFunction } from 'express';
import { hasPermission, sendUnauthorizedResponse } from './auth.js';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return sendUnauthorizedResponse(req, res);
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
  }
  next();
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return sendUnauthorizedResponse(req, res);
    }
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Permission required: ${permission}`,
      });
    }
    next();
  };
}
