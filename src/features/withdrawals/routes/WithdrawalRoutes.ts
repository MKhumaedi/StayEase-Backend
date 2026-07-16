import { Router } from 'express';
import { requireAuth } from '../../../middlewares/AuthMiddleware';
import { withdrawalController } from '../controllers/WithdrawalController';
import { IdempotencyMiddleware, DuplicateSubmissionGuard, RequestGuard } from '../../../protection';

const router = Router();

// Tenant Routes
router.get('/tenant/balance', requireAuth as any, (req, res) => withdrawalController.getTenantBalance(req, res));
router.get('/tenant/list', requireAuth as any, (req, res) => withdrawalController.listTenantWithdrawals(req, res));
router.post(
  '/tenant/request',
  requireAuth as any,
  IdempotencyMiddleware as any,
  DuplicateSubmissionGuard as any,
  RequestGuard('withdrawal_request', (req) => req.userId + '_' + req.body.amount) as any,
  (req, res) => withdrawalController.requestWithdrawal(req, res)
);

// Admin Routes
router.get('/admin/list', requireAuth as any, (req, res) => withdrawalController.listAllWithdrawals(req, res));
router.post('/admin/:id/approve', requireAuth as any, (req, res) => withdrawalController.approveWithdrawal(req, res));
router.post('/admin/:id/reject', requireAuth as any, (req, res) => withdrawalController.rejectWithdrawal(req, res));
router.post('/admin/:id/pay', requireAuth as any, (req, res) => withdrawalController.markAsPaid(req, res));

export default router;
