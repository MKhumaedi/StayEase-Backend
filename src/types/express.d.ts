import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      userRole?: string;
      tenantId?: string;
      propertyId?: string;
      sessionId?: string;
    }
  }
}
