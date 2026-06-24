import { Router } from 'express';
import { reviewController } from '../controllers/ReviewController';
import { requireAuth } from '../../../middlewares/AuthMiddleware';

const router = Router();

// Public routes
router.get('/properties/:propertyId', (req, res) => reviewController.getPropertyReviews(req, res));
router.get('/:id/reply', (req, res) => reviewController.getReplyByReviewId(req, res));

// Authenticated routes
import { IdempotencyMiddleware, DuplicateSubmissionGuard, RequestGuard } from '../../../protection';

router.post('/', requireAuth as any, IdempotencyMiddleware as any, DuplicateSubmissionGuard as any, RequestGuard('review_submit', (req) => req.body.bookingId || req.body.propertyId || '') as any, (req, res) => reviewController.createReview(req, res));
router.put('/:id', requireAuth as any, (req, res) => reviewController.updateReview(req, res));
router.delete('/:id', requireAuth as any, (req, res) => reviewController.deleteReview(req, res));
router.post('/:id/reply', requireAuth as any, (req, res) => reviewController.replyReview(req, res));
router.put('/:id/reply', requireAuth as any, (req, res) => reviewController.updateReply(req, res));
router.delete('/:id/reply', requireAuth as any, (req, res) => reviewController.deleteReply(req, res));
router.get('/host', requireAuth as any, (req, res) => reviewController.getHostReviews(req, res));

export default router;
