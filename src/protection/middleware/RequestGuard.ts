import { Request, Response, NextFunction } from 'express';
import { requestLockService } from '../services/RequestLockService';
import { PROTECTION_CONSTANTS } from '../constants/protection.constants';

export function RequestGuard(resourceName: string, getLockKey?: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).userId || req.ip || 'anonymous';
    const specificKey = getLockKey ? getLockKey(req) : '';
    const lockKey = `lock:${resourceName}:${userId}:${specificKey}`;

    const acquired = requestLockService.acquire(lockKey, PROTECTION_CONSTANTS.LOCK_TIMEOUT_MS);

    if (!acquired) {
      res.status(423).json({
        error: `Action locked: Another '${resourceName}' operation is currently processing for your account. Please wait.`
      });
      return;
    }

    // Attach release function to response finish helpers
    let released = false;
    const releaseLock = () => {
      if (!released) {
        requestLockService.release(lockKey);
        released = true;
      }
    };

    res.on('finish', releaseLock);
    res.on('close', releaseLock);

    next();
  };
}
