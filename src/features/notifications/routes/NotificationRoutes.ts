import { Router } from 'express';
import { requireAuth } from '../../../middlewares/AuthMiddleware';
import { notificationController } from '../controllers/NotificationController';

const router = Router();

router.use(requireAuth as any);

router.get('/', (req, res) => notificationController.list(req, res));
router.put('/read-all', (req, res) => notificationController.markAllRead(req, res));
router.put('/:id/read', (req, res) => notificationController.markRead(req, res));
router.delete('/delete-all', (req, res) => notificationController.deleteAll(req, res));
router.delete('/:id', (req, res) => notificationController.delete(req, res));

export default router;
