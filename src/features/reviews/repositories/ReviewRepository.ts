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

  async findHostReviews(tenantId: string, page = 1, limit = 10, filters?: {
    propertyId?: string;
    rating?: number;
    hasReply?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }) {
    const where: any = {
      property: {
        tenantId
      },
      deletedAt: null
    };

    if (filters) {
      if (filters.propertyId && filters.propertyId !== 'all') {
        where.propertyId = filters.propertyId;
      }
      if (filters.rating) {
        where.rating = Number(filters.rating);
      }
      if (filters.hasReply === 'true') {
        where.replyComment = { not: null };
      } else if (filters.hasReply === 'false') {
        where.replyComment = null;
      }

      if (filters.startDate || filters.endDate) {
        where.createdAt = {};
        if (filters.startDate) {
          where.createdAt.gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          const d = new Date(filters.endDate);
          d.setHours(23, 59, 59, 999);
          where.createdAt.lte = d;
        }
      }

      if (filters.search) {
        const searchPattern = filters.search.trim();
        where.OR = [
          { guestName: { contains: searchPattern, mode: 'insensitive' } },
          { comment: { contains: searchPattern, mode: 'insensitive' } },
          { replyComment: { contains: searchPattern, mode: 'insensitive' } },
          { property: { name: { contains: searchPattern, mode: 'insensitive' } } },
          { booking: { bookingCode: { contains: searchPattern, mode: 'insensitive' } } }
        ];
      }
    }

    return prisma.review.findMany({
      where,
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
        },
        booking: {
          select: {
            id: true,
            bookingCode: true
          }
        }
      }
    });
  }

  async countHostReviews(tenantId: string, filters?: {
    propertyId?: string;
    rating?: number;
    hasReply?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<number> {
    const where: any = {
      property: {
        tenantId
      },
      deletedAt: null
    };

    if (filters) {
      if (filters.propertyId && filters.propertyId !== 'all') {
        where.propertyId = filters.propertyId;
      }
      if (filters.rating) {
        where.rating = Number(filters.rating);
      }
      if (filters.hasReply === 'true') {
        where.replyComment = { not: null };
      } else if (filters.hasReply === 'false') {
        where.replyComment = null;
      }

      if (filters.startDate || filters.endDate) {
        where.createdAt = {};
        if (filters.startDate) {
          where.createdAt.gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          const d = new Date(filters.endDate);
          d.setHours(23, 59, 59, 999);
          where.createdAt.lte = d;
        }
      }

      if (filters.search) {
        const searchPattern = filters.search.trim();
        where.OR = [
          { guestName: { contains: searchPattern, mode: 'insensitive' } },
          { comment: { contains: searchPattern, mode: 'insensitive' } },
          { replyComment: { contains: searchPattern, mode: 'insensitive' } },
          { property: { name: { contains: searchPattern, mode: 'insensitive' } } },
          { booking: { bookingCode: { contains: searchPattern, mode: 'insensitive' } } }
        ];
      }
    }

    return prisma.review.count({
      where
    });
  }
}

export const reviewRepository = new ReviewRepository();
