import { Router } from 'express';
import { requireAuth } from '../../../middlewares/AuthMiddleware';
import { tenantPaymentsController } from '../controllers/TenantPaymentsController';

const router = Router();

router.get('/', requireAuth as any, (req, res) => tenantPaymentsController.listPayments(req, res));
router.post('/:bookingId/approve', requireAuth as any, (req, res) => tenantPaymentsController.approvePayment(req, res));
router.post('/:bookingId/reject', requireAuth as any, (req, res) => tenantPaymentsController.rejectPayment(req, res));

export default router;
