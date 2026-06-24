import { Request, Response, NextFunction } from 'express';
import { idempotencyService } from '../services/IdempotencyService';
import { PROTECTION_CONSTANTS } from '../constants/protection.constants';

export function IdempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.headers[PROTECTION_CONSTANTS.IDEMPOTENCY_HEADER] as string;

  if (!key) {
    return next();
  }

  const record = idempotencyService.get(key);

  if (record) {
    if (record.status === 'PENDING') {
      res.status(409).json({
        error: 'Conflict: A request with the same idempotency key is already in progress.'
      });
      return;
    }
    
    if (record.status === 'COMPLETED') {
      if (record.responseHeaders) {
        for (const [hKey, hVal] of Object.entries(record.responseHeaders)) {
          res.setHeader(hKey, hVal as string);
        }
      }
      res.setHeader('x-cache-idempotency', 'true');
      res.status(record.responseStatus || 200).json(record.responseBody);
      return;
    }
  }

  // First time seeing this key, mark as pending
  idempotencyService.setPending(key);

  // Capture original res.json to cache it on completion
  const originalJson = res.json;
  res.json = function (body: any): Response {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      idempotencyService.resolve(key, res.statusCode, body);
    } else {
      idempotencyService.fail(key);
    }
    return originalJson.call(this, body);
  };

  const originalSend = res.send;
  res.send = function (body: any): Response {
    let parsedBody = body;
    if (typeof body === 'string') {
      try {
        parsedBody = JSON.parse(body);
      } catch {
        parsedBody = body;
      }
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      idempotencyService.resolve(key, res.statusCode, parsedBody);
    } else {
      idempotencyService.fail(key);
    }
    return originalSend.call(this, body);
  };

  next();
}
