import { prisma } from '../../../database/prisma';
import { BookingStatus } from '@prisma/client';

export class BookingRepository {
  async findById(id: string) {
    return prisma.booking.findFirst({
      where: { id, deletedAt: null },
      include: {
        property: {
          include: {
            tenant: {
              select: { id: true, name: true, email: true }
            }
          }
        },
        room: true,
        paymentProof: true,
        review: true
      }
    });
  }

  async findByCode(code: string) {
    return prisma.booking.findFirst({
      where: { bookingCode: code.toUpperCase(), deletedAt: null },
      include: { property: true, room: true, paymentProof: true }
    });
  }

  async findByGuestId(guestId: string) {
    return prisma.booking.findMany({
      where: { guestId, deletedAt: null },
      include: { property: true, room: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async create(booking: {
    guestId: string;
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    propertyId: string;
    roomId: string;
    startDate: string;
    endDate: string;
    nights: number;
    totalAmount: number;
    status: BookingStatus;
    basePrice?: number;
    peakMultiplier?: number;
    peakSeasonName?: string | null;
    finalRoomPrice?: number;
  }) {
    const codeNum = Math.floor(1000 + Math.random() * 9000);
    return prisma.booking.create({
      data: {
        bookingCode: `SE-${codeNum}`,
        ...booking
      }
    });
  }

  async updateStatus(id: string, status: BookingStatus) {
    return prisma.booking.update({
      where: { id },
      data: { status }
    });
  }

  async saveProof(id: string, proofUrl: string) {
    return prisma.paymentProof.upsert({
      where: { bookingId: id },
      update: { proofUrl, deletedAt: null },
      create: { bookingId: id, proofUrl }
    });
  }

  async delete(id: string) {
    return prisma.booking.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }

  async deleteBooking(id: string) {
    return this.delete(id);
  }

  async restore(id: string) {
    return prisma.booking.update({
      where: { id },
      data: { deletedAt: null }
    });
  }

  async restoreBooking(id: string) {
    return this.restore(id);
  }

  async expireOldPendingBookings(maxAgeMinutes = 30): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    const result = await prisma.booking.updateMany({
      where: {
        status: BookingStatus.WAITING_PAYMENT,
        createdAt: { lt: cutoff },
        deletedAt: null
      },
      data: { status: BookingStatus.CANCELLED }
    });
    return result.count;
  }

  private buildWhere(filters: any) {
    const where: any = { deletedAt: null };
    if (filters.status) {
      if (filters.status === 'EXPIRED') {
        where.status = BookingStatus.AUTO_EXPIRED;
      } else {
        where.status = filters.status;
      }
    }
    if (filters.guestId) where.guestId = filters.guestId;
    if (filters.tenantId) {
      where.property = { tenantId: filters.tenantId };
    }
    if (filters.propertyId) {
      where.propertyId = filters.propertyId;
    }
    if (filters.startDate) {
      where.startDate = { gte: filters.startDate };
    }
    if (filters.endDate) {
      where.endDate = { lte: filters.endDate };
    }
    if (filters.search) {
      where.OR = [
        { guestName: { contains: filters.search, mode: 'insensitive' } },
        { bookingCode: { contains: filters.search, mode: 'insensitive' } }
      ];
    }
    return where;
  }

  async search(filters: { status?: BookingStatus | string; search?: string; page?: number; limit?: number; guestId?: string; tenantId?: string; propertyId?: string; startDate?: string; endDate?: string; }) {
    const { page = 1, limit = 10 } = filters;
    const where = this.buildWhere(filters);
    const [data, total] = await Promise.all([
      prisma.booking.findMany({
        where, skip: (page - 1) * limit, take: limit,
        include: { property: true, room: true, paymentProof: true, review: true },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.booking.count({ where })
    ]);
    return { data, total };
  }

  async checkIn(id: string, userId: string) {
    return prisma.booking.update({
      where: { id },
      data: {
        status: 'CHECKED_IN',
        checkedInAt: new Date(),
        checkedInBy: userId
      },
      include: { property: true, room: true }
    });
  }

  async checkOut(id: string, userId: string) {
    return prisma.booking.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        checkedOutAt: new Date(),
        checkedOutBy: userId
      },
      include: { property: true, room: true }
    });
  }
}

export const bookingRepository = new BookingRepository();
