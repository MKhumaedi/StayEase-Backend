import { reviewRepository } from '../repositories/ReviewRepository';
import { prisma } from '../../../database/prisma';
import { NotificationEngine } from '../../notifications/services/NotificationEngine';

export class ReviewService {
  async submitReview(userId: string, data: {
    bookingId: string;
    rating: number;
    comment: string;
  }) {
    // 1. Find booking
    const booking = await prisma.booking.findFirst({
      where: {
        id: data.bookingId,
        deletedAt: null
      },
      include: {
        property: true,
        guest: true
      }
    });

    if (!booking) {
      throw new Error('Booking not found.');
    }

    // 2. Security and eligibility checks
    if (booking.guestId !== userId) {
      throw new Error('Access denied: You can only review your own bookings.');
    }

    if (booking.status !== 'COMPLETED') {
      throw new Error('You can only submit a review for completed stays.');
    }

    // Check duplicate review
    const existing = await reviewRepository.findByBookingId(data.bookingId);
    if (existing) {
      throw new Error('You have already reviewed this booking.');
    }

    // Validate rating
    if (data.rating < 1 || data.rating > 5) {
      throw new Error('Rating must be between 1 and 5 stars.');
    }

    if (!data.comment || data.comment.trim() === '') {
      throw new Error('Review comment cannot be empty.');
    }

    // 3. Create review
    const review = await reviewRepository.create({
      bookingId: data.bookingId,
      propertyId: booking.propertyId,
      guestId: userId,
      guestName: booking.guest?.name || booking.guestName,
      guestAvatar: booking.guest?.avatarUrl || undefined,
      rating: data.rating,
      comment: data.comment.trim()
    });

    // 4. Recalculate property average score and count
    await this.updatePropertyMetrics(booking.propertyId);

    // 5. Build and send notification to the Host (property owner/tenant)
    try {
      const pName = booking.property?.name || 'your property';
      await NotificationEngine.createNotification({
        userId: booking.property.tenantId,
        title: 'New Review Received',
        message: `${booking.guest?.name || 'A guest'} left a ${data.rating}-star review on "${pName}".`,
        type: 'REVIEW'
      });
    } catch (err) {
      console.error('Failed to dispatch HOST notification for new review:', err);
    }

    return review;
  }

  async replyToReview(tenantId: string, reviewId: string, replyComment: string) {
    if (!replyComment || replyComment.trim() === '') {
      throw new Error('Reply comment cannot be empty.');
    }

    // Retrieve review
    const review = await reviewRepository.findById(reviewId);
    if (!review) {
      throw new Error('Review not found.');
    }

    if (!review.property) {
      throw new Error('Property not found.');
    }

    // Verify ownership of the property
    if (review.property.tenantId !== tenantId) {
      throw new Error('Access denied: You can only reply to reviews on your own properties.');
    }

    // Ensure at most one reply
    if (review.replyComment) {
      throw new Error('Maksimal satu balasan host untuk setiap review.');
    }

    // Save reply
    const updatedReview = await reviewRepository.updateReply(reviewId, replyComment.trim());

    // Send notification to the Guest
    try {
      await NotificationEngine.createNotification({
        userId: review.guestId,
        title: 'Host Replied to Your Review',
        message: `The host of "${review.property.name}" has replied to your review: "${replyComment.trim()}"`,
        type: 'REVIEW'
      });
    } catch (err) {
      console.error('Failed to dispatch GUEST notification for review reply:', err);
    }

    return updatedReview;
  }

  async getReviewReply(reviewId: string) {
    const review = await reviewRepository.findById(reviewId);
    if (!review) {
      throw new Error('Review not found.');
    }
    if (!review.property) {
      throw new Error('Property not found.');
    }
    return {
      replyComment: review.replyComment,
      replyDate: review.replyDate
    };
  }

  async updateReviewReply(tenantId: string, reviewId: string, replyComment: string) {
    if (!replyComment || replyComment.trim() === '') {
      throw new Error('Reply comment cannot be empty.');
    }

    const review = await reviewRepository.findById(reviewId);
    if (!review) {
      throw new Error('Review not found.');
    }
    if (!review.property) {
      throw new Error('Property not found.');
    }

    // Verify ownership of the property
    if (review.property.tenantId !== tenantId) {
      throw new Error('Access denied: You can only edit replies on your own properties.');
    }

    return await reviewRepository.updateReply(reviewId, replyComment.trim());
  }

  async deleteReviewReply(tenantId: string, reviewId: string) {
    const review = await reviewRepository.findById(reviewId);
    if (!review) {
      throw new Error('Review not found.');
    }
    if (!review.property) {
      throw new Error('Property not found.');
    }

    // Verify ownership of the property
    if (review.property.tenantId !== tenantId) {
      throw new Error('Access denied: You can only delete replies on your own properties.');
    }

    return await reviewRepository.updateReply(reviewId, null);
  }

  async updateReview(userId: string, id: string, data: { rating: number; comment: string }) {
    const review = await reviewRepository.findById(id);
    if (!review) {
      throw new Error('Review not found.');
    }
    if (review.guestId !== userId) {
      throw new Error('Access denied: You can only edit your own reviews.');
    }
    if (data.rating < 1 || data.rating > 5) {
      throw new Error('Rating must be between 1 and 5 stars.');
    }
    if (!data.comment || data.comment.trim() === '') {
      throw new Error('Review comment cannot be empty.');
    }

    const updated = await reviewRepository.update(id, {
      rating: data.rating,
      comment: data.comment.trim()
    });

    await this.updatePropertyMetrics(review.propertyId);
    return updated;
  }

  async deleteReview(userId: string, id: string) {
    const review = await reviewRepository.findById(id);
    if (!review) {
      throw new Error('Review not found.');
    }
    if (review.guestId !== userId) {
      throw new Error('Access denied: You can only delete your own reviews.');
    }

    await reviewRepository.delete(id);
    await this.updatePropertyMetrics(review.propertyId);
    return { success: true };
  }

  async updatePropertyMetrics(propertyId: string) {
    const { average, count } = await reviewRepository.getAverageRatingAndCount(propertyId);
    
    // Store in DB, rounded to 2 decimals
    await prisma.property.update({
      where: { id: propertyId },
      data: {
        rating: Math.round(average * 100) / 100,
        reviewCount: count
      }
    });
  }
}

export const reviewService = new ReviewService();
