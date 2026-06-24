import { Response } from 'express';
import { AuthenticatedRequest } from '../../../middlewares/AuthMiddleware';
import { notificationRepository } from '../repositories/NotificationRepository';

export class NotificationController {
  async list(req: AuthenticatedRequest, res: Response) {
    try {
      const list = await notificationRepository.getByUserId(req.userId || '');
      res.json({ notifications: list });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async markRead(req: AuthenticatedRequest, res: Response) {
    try {
      await notificationRepository.markRead(req.params.id, req.userId || '');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async markAllRead(req: AuthenticatedRequest, res: Response) {
    try {
      await notificationRepository.markAllRead(req.userId || '');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async delete(req: AuthenticatedRequest, res: Response) {
    try {
      await notificationRepository.delete(req.params.id, req.userId || '');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async deleteAll(req: AuthenticatedRequest, res: Response) {
    try {
      await notificationRepository.deleteAll(req.userId || '');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}

export const notificationController = new NotificationController();
