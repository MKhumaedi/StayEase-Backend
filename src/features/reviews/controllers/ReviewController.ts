import { Response } from 'express';
import { reviewService } from '../services/ReviewService';
import { reviewRepository } from '../repositories/ReviewRepository';
import { AuthenticatedRequest } from '../../../middlewares/AuthMiddleware';
import { prisma } from '../../../database/prisma';

export class ReviewController {
  async createReview(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { bookingId, rating, comment } = req.body;
      if (!bookingId) {
        res.status(400).json({ error: 'bookingId is required.' });
        return;
      }
      
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized session.' });
        return;
      }

      const review = await reviewService.submitReview(userId, {
        bookingId,
        rating: Number(rating),
        comment
      });

      res.status(201).json({ success: true, review });
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async replyReview(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { replyComment } = req.body;
      const tenantId = req.userId;

      if (req.userRole !== 'TENANT' || !tenantId) {
        res.status(403).json({ error: 'Forbidden: Only tenants can reply to reviews.' });
        return;
      }

      const review = await reviewService.replyToReview(tenantId, id, replyComment);
      res.json({ success: true, review });
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async getReplyByReviewId(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data = await reviewService.getReviewReply(id);
      res.json(data);
    } catch (err: any) {
      res.status(404).json({ error: err.message || err });
    }
  }

  async updateReply(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { replyComment } = req.body;
      const tenantId = req.userId;

      if (req.userRole !== 'TENANT' || !tenantId) {
        res.status(403).json({ error: 'Forbidden: Only tenants can manage review replies.' });
        return;
      }

      const review = await reviewService.updateReviewReply(tenantId, id, replyComment);
      res.json({ success: true, review });
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async deleteReply(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.userId;

      if (req.userRole !== 'TENANT' || !tenantId) {
        res.status(403).json({ error: 'Forbidden: Only tenants can manage review replies.' });
        return;
      }

      await reviewService.deleteReviewReply(tenantId, id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async updateReview(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.status(403).json({ error: 'Forbidden: Travelers are not allowed to edit reviews once submitted. Only administrators can moderate reviews.' });
  }

  async deleteReview(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.status(403).json({ error: 'Forbidden: Travelers are not allowed to delete reviews once submitted. Only administrators can moderate reviews.' });
  }

  async getPropertyReviews(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      let { propertyId } = req.params;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 5;

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId);
      if (!isUuid) {
        const property = await prisma.property.findFirst({
          where: { slug: propertyId, deletedAt: null }
        });
        if (property) {
          propertyId = property.id;
        }
      }

      const reviews = await reviewRepository.findByPropertyId(propertyId, page, limit);
      const total = await reviewRepository.countByPropertyId(propertyId);
      const stats = await reviewRepository.getAverageRatingAndCount(propertyId);

      res.json({
        reviews,
        total,
        page,
        limit,
        averageRating: stats.average,
        totalReviews: stats.count
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async getHostReviews(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.userId;
      if (!tenantId || req.userRole !== 'TENANT') {
        res.status(403).json({ error: 'Access denied: Host session required.' });
        return;
      }

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;

      const { propertyId, rating, hasReply, startDate, endDate, search } = req.query;
      const filters = {
        propertyId: propertyId ? String(propertyId) : undefined,
        rating: rating ? Number(rating) : undefined,
        hasReply: hasReply ? String(hasReply) : undefined,
        startDate: startDate ? String(startDate) : undefined,
        endDate: endDate ? String(endDate) : undefined,
        search: search ? String(search) : undefined,
      };

      const reviews = await reviewRepository.findHostReviews(tenantId, page, limit, filters);
      const total = await reviewRepository.countHostReviews(tenantId, filters);
      const stats = await Promise.all(
        reviews.map(async r => {
          return await reviewRepository.getAverageRatingAndCount(r.propertyId);
        })
      );

      res.json({
        reviews,
        total,
        page,
        limit
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}

export const reviewController = new ReviewController();
