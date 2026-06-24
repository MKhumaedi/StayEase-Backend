import { prisma } from '../../../database/prisma';

export class ReviewRepository {
  async findById(id: string) {
    return prisma.review.findFirst({
      where: { id, deletedAt: null },
      include: { property: true, guest: true, booking: true }
    });
  }

  async findByBookingId(bookingId: string) {
    return prisma.review.findFirst({
      where: { bookingId, deletedAt: null }
    });
  }

  async findByPropertyId(propertyId: string, page = 1, limit = 5) {
    return prisma.review.findMany({
      where: { propertyId, deletedAt: null },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        guest: {
          select: {
            id: true,
            name: true,
            avatarUrl: true
          }
        }
      }
    });
  }

  async countByPropertyId(propertyId: string): Promise<number> {
    return prisma.review.count({
      where: { propertyId, deletedAt: null }
    });
  }

  async getAverageRatingAndCount(propertyId: string) {
    const aggregate = await prisma.review.aggregate({
      where: { propertyId, deletedAt: null },
      _avg: { rating: true },
      _count: { id: true }
    });

    return {
      average: aggregate._avg.rating ? Number(aggregate._avg.rating) : 0,
      count: aggregate._count.id || 0
    };
  }

  async create(data: {
    bookingId: string;
    propertyId: string;
    guestId: string;
    guestName: string;
    guestAvatar?: string;
    rating: number;
    comment: string;
  }) {
    return prisma.review.create({
      data
    });
  }

  async update(id: string, data: { rating?: number; comment?: string }) {
    return prisma.review.update({
      where: { id },
      data
    });
  }

  async delete(id: string) {
    return prisma.review.update({
      where: { id },
      data: {
        deletedAt: new Date().toISOString()
      }
    });
  }

  async updateReply(id: string, replyComment: string | null) {
    return prisma.review.update({
      where: { id },
      data: {
        replyComment,
        replyDate: replyComment ? new Date().toISOString().split('T')[0] : null
      }
    });
  }

  async findHostReviews(tenantId: string, page = 1, limit = 10) {
    return prisma.review.findMany({
      where: {
        property: {
          tenantId
        },
        deletedAt: null
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            tenantId: true
          }
        },
        guest: {
          select: {
            id: true,
            name: true,
            avatarUrl: true
          }
        }
      }
    });
  }

  async countHostReviews(tenantId: string): Promise<number> {
    return prisma.review.count({
      where: {
        property: {
          tenantId
        },
        deletedAt: null
      }
    });
  }
}

export const reviewRepository = new ReviewRepository();
