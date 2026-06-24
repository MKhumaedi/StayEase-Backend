import { Request, Response, NextFunction } from 'express';
import { duplicateRequestService } from '../services/DuplicateRequestService';
import { PROTECTION_CONSTANTS } from '../constants/protection.constants';

export function DuplicateSubmissionGuard(req: Request, res: Response, next: NextFunction) {
  // Only guard mutations (POST, PUT, DELETE, PATCH)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Retrieve client identifier (User ID or IP)
  const clientId = (req as any).userId || req.ip || 'unknown-client';
  const path = req.originalUrl || req.path;

  const isDup = duplicateRequestService.isDuplicate(
    clientId,
    path,
    req.body,
    PROTECTION_CONSTANTS.DUPLICATE_WINDOW_MS
  );

  if (isDup) {
    res.status(429).json({
      error: 'Duplicate request blocked. Please wait a moment before trying again.'
    });
    return;
  }

  next();
}
