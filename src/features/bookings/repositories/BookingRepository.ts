import { prisma } from '../../../database/prisma';
import { BookingStatus } from '@prisma/client';
import { BookingSearchInput } from '../validations/BookingValidation';

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

  private buildWhere(filters: BookingSearchInput) {
    const where: any = { deletedAt: null };
    
    if (filters.status && filters.status !== 'ALL') {
      if (filters.status === 'EXPIRED') {
        where.status = BookingStatus.AUTO_EXPIRED;
      } else if (filters.status === 'LATE_CHECKIN') {
        where.status = BookingStatus.CONFIRMED;
        const tzOffsetVal = new Date().getTimezoneOffset() * 60000;
        const todayStr = new Date(Date.now() - tzOffsetVal).toISOString().split('T')[0];
        where.startDate = { lt: todayStr };
      } else if (filters.status === 'WAITING_CHECKIN') {
        where.status = BookingStatus.CONFIRMED;
      } else {
        where.status = filters.status as any;
      }
    }

    if (filters.guestId) where.guestId = filters.guestId;
    if (filters.tenantId) {
      where.property = { tenantId: filters.tenantId };
    }
    if (filters.propertyId) {
      where.propertyId = filters.propertyId;
    }

    const isCheckInOnly = (filters as any).checkInOnly === 'true' || (filters as any).checkInOnly === true;
    if (isCheckInOnly && (!filters.status || filters.status === 'ALL')) {
      where.status = {
        in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.CHECKED_OUT, BookingStatus.COMPLETED]
      };
    }

    if (isCheckInOnly) {
      if (filters.status !== 'LATE_CHECKIN') {
        if (filters.startDate && filters.endDate) {
          where.startDate = { gte: filters.startDate, lte: filters.endDate };
        } else if (filters.startDate) {
          where.startDate = { gte: filters.startDate };
        } else if (filters.endDate) {
          where.startDate = { lte: filters.endDate };
        }
      } else {
        const tzOffsetVal = new Date().getTimezoneOffset() * 60000;
        const todayStr = new Date(Date.now() - tzOffsetVal).toISOString().split('T')[0];
        const merged: any = { lt: todayStr };
        if (filters.startDate && filters.startDate < todayStr) {
          merged.gte = filters.startDate;
        }
        if (filters.endDate && filters.endDate < todayStr) {
          merged.lte = filters.endDate;
        }
        where.startDate = merged;
      }
    } else {
      if (filters.startDate) {
        where.startDate = { gte: filters.startDate };
      }
      if (filters.endDate) {
        where.endDate = { lte: filters.endDate };
      }
    }

    if (filters.search) {
      where.OR = [
        { guestName: { contains: filters.search, mode: 'insensitive' } },
        { bookingCode: { contains: filters.search, mode: 'insensitive' } }
      ];
    }
    if (filters.checkoutRequested !== undefined) {
      where.checkoutRequested = filters.checkoutRequested === 'true' || filters.checkoutRequested === true;
    }
    if (filters.checkedOutAtNull !== undefined) {
      if (filters.checkedOutAtNull === 'true' || filters.checkedOutAtNull === true) {
        where.checkedOutAt = null;
      }
    }
    return where;
  }

  async search(filters: BookingSearchInput) {
    const { page = 1, limit = 10 } = filters;
    const where = this.buildWhere(filters);

    // TEMPORARY LOGGING:
    console.log('[BOOKING BACKEND AUDIT] Received Filters:', JSON.stringify(filters, null, 2));
    console.log('[BOOKING BACKEND AUDIT] Constructed Prisma Where:', JSON.stringify(where, null, 2));

    const [data, total] = await Promise.all([
      prisma.booking.findMany({
        where, skip: (page - 1) * limit, take: limit,
        include: {
          property: {
            select: {
              id: true,
              slug: true,
              name: true,
              location: true,
              city: true,
              province: true,
              imageUrls: true,
              tenantId: true
            }
          },
          room: {
            select: {
              id: true,
              name: true,
              type: true,
              capacity: true,
              basePrice: true,
              status: true
            }
          },
          paymentProof: {
            select: {
              id: true,
              proofUrl: true
            }
          },
          review: {
            select: {
              id: true,
              rating: true,
              comment: true,
              replyComment: true,
              replyDate: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.booking.count({ where })
    ]);

    // TEMPORARY LOGGING:
    console.log(`[BOOKING BACKEND AUDIT] Found ${data.length} bookings, total ${total}`);

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

  async requestCheckOut(id: string) {
    return prisma.booking.update({
      where: { id },
      data: {
        status: 'CHECKED_IN',
        checkoutRequested: true,
        actualCheckoutRequestAt: new Date()
      },
      include: { property: true, room: true }
    });
  }

  async requestCheckout(id: string) {
    return this.requestCheckOut(id);
  }

  async confirmCheckOut(id: string, userId: string) {
    return prisma.$transaction(async (tx) => {
      // 1. Validasi booking masih CHECKED_IN
      const booking = await tx.booking.findFirst({
        where: { id, deletedAt: null },
        include: { property: true, room: true }
      });
      if (!booking) {
        throw new Error('Booking tidak ditemukan.');
      }
      if (booking.status !== 'CHECKED_IN') {
        throw new Error('Validasi gagal: Booking status bukan CHECKED_IN.');
      }

      // 3. Update booking
      const updatedBooking = await tx.booking.update({
        where: { id },
        data: {
          status: 'CHECKED_OUT',
          checkoutRequested: false,
          checkedOutAt: new Date(),
          checkedOutBy: userId
        },
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

      // 4. Update room
      if (booking.roomId) {
        await tx.room.update({
          where: { id: booking.roomId },
          data: { status: 'Available' }
        });
      }

      // 5. Update room availability
      if (booking.roomId) {
        const cur = new Date(booking.startDate + 'T00:00:00');
        const stop = new Date(booking.endDate + 'T00:00:00');
        while (cur < stop) {
          const dStr = cur.toISOString().split('T')[0];
          await tx.roomAvailability.upsert({
            where: { roomId_date: { roomId: booking.roomId, date: dStr } },
            update: { isBlocked: false },
            create: { roomId: booking.roomId, date: dStr, isBlocked: false }
          });
          cur.setDate(cur.getDate() + 1);
        }
      }

      return updatedBooking;
    });
  }

  async confirmCheckout(id: string, userId: string) {
    return this.confirmCheckOut(id, userId);
  }

  async checkOut(id: string, userId: string) {
    return this.confirmCheckOut(id, userId);
  }
}

export const bookingRepository = new BookingRepository();
