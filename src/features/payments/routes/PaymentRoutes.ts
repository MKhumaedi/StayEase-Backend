import { Router } from 'express';
import { paymentController } from '../controllers/PaymentController';
import { requireAuth } from '../../../middlewares/AuthMiddleware';

const router = Router();

router.post('/midtrans/create-transaction', requireAuth as any, (req, res) => paymentController.createTransaction(req, res));
router.post('/midtrans/webhook', (req, res) => paymentController.handleWebhook(req, res));

export default router;
