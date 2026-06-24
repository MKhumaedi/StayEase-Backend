import { bookingRepository } from '../repositories/BookingRepository';
import { propertyService } from '../../properties/services/PropertyService';
import { propertyRepository } from '../../properties/repositories/PropertyRepository';
import { BookingStatus } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { NotificationEngine } from '../../notifications/services/NotificationEngine';

export class BookingService {
  private validateDatesOrder(start: string, end: string): void {
    const sDate = new Date(start);
    const eDate = new Date(end);
    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
      throw new Error('Invalid dates provided.');
    }
    if (sDate >= eDate) {
      throw new Error('Check-in date must be before Check-out date.');
    }
  }

  private async checkOverlap(roomId: string, start: string, end: string, excludeId?: string): Promise<void> {
    const overlapping = await prisma.booking.findFirst({
      where: {
        roomId,
        status: { notIn: [BookingStatus.CANCELLED, BookingStatus.AUTO_EXPIRED] },
        deletedAt: null,
        NOT: excludeId ? { id: excludeId } : undefined,
        AND: [
          { startDate: { lt: end } },
          { endDate: { gt: start } }
        ]
      }
    });
    if (overlapping) throw new Error('This room is already booked for the selected dates.');
  }

  private async checkBlocked(roomId: string, start: string, end: string): Promise<void> {
    const blocked = await prisma.roomAvailability.findFirst({
      where: { roomId, isBlocked: true, date: { gte: start, lt: end }, deletedAt: null }
    });
    if (blocked) {
      throw new Error('This room is blocked or is unavailable on the selected dates.');
    }
  }

  private async createNotifications(guestId: string, tenantId: string, pName: string, code: string, gName: string) {
    await NotificationEngine.createMany([
      {
        userId: guestId,
        title: 'Booking Confirmed!',
        message: `Your booking at ${pName} (Code: ${code}) is currently waiting for payment.`,
        type: 'BOOKING'
      },
      {
        userId: tenantId,
        title: 'New Reservation Received',
        message: `${gName} requested a booking at ${pName} (Code: ${code}).`,
        type: 'BOOKING'
      }
    ]);
  }

  private async getBookingDetails(propId: string, roomId: string, start: string, end: string) {
    const prop = await propertyRepository.findById(propId);
    if (!prop) throw new Error('Property not found');
    const q = await propertyService.calculateTotalQuote(propId, roomId, start, end);
    const nights = Math.max(1, this.diffDays(start, end));
    return { prop, nights, amount: q.total };
  }

  async initiateBooking(data: any) {
    this.validateDatesOrder(data.startDate, data.endDate);
    const rId = data.roomId || 'room-1';
    await this.checkOverlap(rId, data.startDate, data.endDate);
    await this.checkBlocked(rId, data.startDate, data.endDate);
    const details = await this.getBookingDetails(data.propertyId, rId, data.startDate, data.endDate);
    
    // Resolve peak season snapshot details
    const peakRates = await prisma.peakSeasonRate.findMany({
      where: {
        propertyId: data.propertyId,
        deletedAt: null,
        isActive: true
      }
    });

    const roomObj = await prisma.room.findFirst({
      where: { id: rId, deletedAt: null }
    });
    
    const basePriceNum = roomObj ? Number(roomObj.basePrice) : Number(details.prop.basePrice || 0);

    // List all stay dates
    const stayDates: string[] = [];
    const curDate = new Date(data.startDate + 'T00:00:00');
    const endDate = new Date(data.endDate + 'T00:00:00');
    while (curDate < endDate) {
      const yyyy = curDate.getFullYear();
      const mm = String(curDate.getMonth() + 1).padStart(2, '0');
      const dd = String(curDate.getDate()).padStart(2, 'a');
      const ddStr = String(curDate.getDate()).padStart(2, '0');
      stayDates.push(`${yyyy}-${mm}-${ddStr}`);
      curDate.setDate(curDate.getDate() + 1);
    }

    let matchedPeakSeason: any = null;
    for (const dStr of stayDates) {
      // Prioritize room-specific peak rates
      const match = peakRates.find(p => dStr >= p.startDate && dStr <= p.endDate && p.roomId === rId);
      if (match) {
        matchedPeakSeason = match;
        break;
      }
    }
    if (!matchedPeakSeason) {
      for (const dStr of stayDates) {
        const match = peakRates.find(p => dStr >= p.startDate && dStr <= p.endDate && !p.roomId);
        if (match) {
          matchedPeakSeason = match;
          break;
        }
      }
    }

    const peakSeasonName = matchedPeakSeason ? matchedPeakSeason.name : null;
    const peakMultiplier = matchedPeakSeason ? Number(matchedPeakSeason.rateMultiplier) : 1.0;
    const finalRoomPrice = matchedPeakSeason ? Math.round(basePriceNum * peakMultiplier) : basePriceNum;

    const created = await bookingRepository.create({
      guestId: data.guestId, guestName: data.guestName, guestEmail: data.guestEmail, guestPhone: data.guestPhone,
      propertyId: data.propertyId, roomId: rId, startDate: data.startDate, endDate: data.endDate,
      nights: details.nights, totalAmount: details.amount, status: BookingStatus.WAITING_PAYMENT,
      basePrice: basePriceNum,
      peakMultiplier,
      peakSeasonName,
      finalRoomPrice
    });
    await this.createNotifications(data.guestId, details.prop.tenantId, details.prop.name, created.bookingCode, data.guestName);
    return created;
  }

  async confirmBookingPayment(bookingId: string, proofUrl: string) {
    const booking = await bookingRepository.findById(bookingId);
    if (!booking) throw new Error('Booking not found');
    const roomId = booking.roomId || 'room-1';
    await this.checkOverlap(roomId, booking.startDate, booking.endDate, bookingId);
    await this.checkBlocked(roomId, booking.startDate, booking.endDate);
    await bookingRepository.saveProof(bookingId, proofUrl);
    await bookingRepository.updateStatus(bookingId, BookingStatus.WAITING_CONFIRMATION);
    const updated = await bookingRepository.findById(bookingId);
    if (!updated) throw new Error('Refetch failed');
    return updated;
  }

  private diffDays(start: string, end: string): number {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }

  async getReportStats(landlordId?: string) {
    if (!landlordId) {
      return {
        totalRevenue: 0,
        occupancyRate: 0,
        pendingOrders: 0,
        newReviews: 0,
        totalProperties: 0,
        activeRooms: 0,
        monthlyBookings: 0,
        revenueAnalytics: [],
        growthRate: 0,
        performance: {
          topPerforming: null,
          lowestPerforming: null,
          highestOccupancy: null,
          highestRevenue: null
        }
      };
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const startOfCurrentMonth = new Date(currentYear, currentMonth, 1);
    const endOfCurrentMonth = new Date(currentYear, currentMonth + 1, 1);

    // Fetch properties with rooms and bookings
    const propertiesWithData = await prisma.property.findMany({
      where: { tenantId: landlordId, deletedAt: null },
      include: {
        rooms: {
          where: { deletedAt: null }
        },
        bookings: {
          where: {
            deletedAt: null
          },
          include: {
            room: true
          }
        },
        reviews: {
          where: { deletedAt: null }
        }
      }
    });

    const totalProperties = propertiesWithData.length;
    
    // Count active rooms
    const activeRooms = propertiesWithData.reduce((acc, p) => acc + p.rooms.length, 0);

    // Filter confirmed/completed bookings for the current month
    const currentMonthBookings = propertiesWithData.flatMap(p => p.bookings).filter(b => {
      const matchStatus = b.status === 'CONFIRMED' || b.status === 'COMPLETED';
      const createdDate = new Date(b.createdAt);
      const matchMonth = createdDate >= startOfCurrentMonth && createdDate < endOfCurrentMonth;
      return matchStatus && matchMonth;
    });

    // Total monthly revenue (from confirmed/completed bookings of the current month)
    const totalRevenue = currentMonthBookings.reduce((sum, b) => sum + Number(b.totalAmount), 0);

    // Total monthly bookings (all bookings created in current month, regardless of status but excluding deleted/canceled ones)
    const monthlyBookings = propertiesWithData.flatMap(p => p.bookings).filter(b => {
      const createdDate = new Date(b.createdAt);
      return createdDate >= startOfCurrentMonth && createdDate < endOfCurrentMonth && b.status !== 'CANCELLED';
    }).length;

    // Occupancy Rate: Booked Room Nights in Current Month / Available Room Nights in Current Month
    const bookedRoomNights = currentMonthBookings.reduce((sum, b) => sum + b.nights, 0);
    const availableRoomNights = activeRooms * daysInMonth;
    const occupancyRate = availableRoomNights > 0 
      ? Number(((bookedRoomNights / availableRoomNights) * 100).toFixed(1))
      : 0.0;

    // Pending bookings count
    const pendingOrders = propertiesWithData.flatMap(p => p.bookings).filter(b => b.status === 'WAITING_CONFIRMATION').length;

    // Total reviews count
    const newReviews = propertiesWithData.reduce((acc, p) => acc + p.reviews.length, 0);

    // Last 12 months revenueAnalytics
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const revenueAnalytics = [];
    
    // Flatten all bookings once
    const allBookings = propertiesWithData.flatMap(p => p.bookings);

    for (let i = 11; i >= 0; i--) {
      const monthDate = new Date(currentYear, currentMonth - i, 1);
      const nextMonthDate = new Date(currentYear, currentMonth - i + 1, 1);

      const monthlyConfirmedBookings = allBookings.filter(b => {
        const matchStatus = b.status === 'CONFIRMED' || b.status === 'COMPLETED';
        const createdDate = new Date(b.createdAt);
        return matchStatus && createdDate >= monthDate && createdDate < nextMonthDate;
      });

      const label = `${monthNames[monthDate.getMonth()]} ${monthDate.getFullYear().toString().slice(-2)}`;
      const rev = monthlyConfirmedBookings.reduce((sum, b) => sum + Number(b.totalAmount), 0);
      const exp = Number((rev * 0.15).toFixed(2));
      const net = Number((rev - exp).toFixed(2));

      revenueAnalytics.push({
        month: label,
        amt: rev, // Compatible with BarChart dataKey="amt"
        revenue: rev,
        expenses: exp,
        netIncome: net
      });
    }

    const curRev = revenueAnalytics[11]?.revenue || 0;
    const prevRev = revenueAnalytics[10]?.revenue || 0;
    const growthRate = prevRev > 0 
      ? Number((((curRev - prevRev) / prevRev) * 100).toFixed(1)) 
      : (curRev > 0 ? 100.0 : 0.0);

    // Compute property performance
    const performanceList = propertiesWithData.map(p => {
      const roomsCount = p.rooms.length;
      const confirmedBookings = p.bookings.filter(b => b.status === 'CONFIRMED' || b.status === 'COMPLETED');
      const bookingsCount = confirmedBookings.length;
      const revenue = confirmedBookings.reduce((sum, b) => sum + Number(b.totalAmount), 0);
      const bookedNights = confirmedBookings.reduce((sum, b) => sum + b.nights, 0);

      const availRoomNights = roomsCount * daysInMonth;
      const occRate = availRoomNights > 0 
        ? Number(((bookedNights / availRoomNights) * 100).toFixed(1))
        : 0.0;

      return {
        id: p.id,
        name: p.name,
        bookingsCount,
        revenue,
        occupancyRate: occRate
      };
    });

    const topPerforming = performanceList.length > 0 
      ? [...performanceList].sort((a, b) => b.bookingsCount - a.bookingsCount || b.revenue - a.revenue)[0] 
      : null;

    const lowestPerforming = performanceList.length > 0 
      ? [...performanceList].sort((a, b) => a.bookingsCount - b.bookingsCount || a.revenue - b.revenue)[0] 
      : null;

    const highestOccupancy = performanceList.length > 0 
      ? [...performanceList].sort((a, b) => b.occupancyRate - a.occupancyRate)[0] 
      : null;

    const highestRevenue = performanceList.length > 0 
      ? [...performanceList].sort((a, b) => b.revenue - a.revenue)[0] 
      : null;

    // Operations metrics
    // Get YYYY-MM-DD date string
    const todayStr = new Date().toISOString().split('T')[0];

    const todayCheckInsCount = allBookings.filter(b => b.status === 'CONFIRMED' && b.startDate === todayStr).length;
    const todayCheckOutsCount = allBookings.filter(b => b.status === 'CHECKED_IN' && b.endDate === todayStr).length;
    const guestsStayingNowCount = allBookings.filter(b => b.status === 'CHECKED_IN').length;
    const lateCheckOutsCount = allBookings.filter(b => b.status === 'CHECKED_IN' && todayStr > b.endDate).length;

    return {
      totalRevenue,
      occupancyRate,
      pendingOrders,
      newReviews,
      totalProperties,
      activeRooms,
      monthlyBookings,
      revenueAnalytics,
      growthRate,
      performance: {
        topPerforming,
        lowestPerforming,
        highestOccupancy,
        highestRevenue
      },
      operations: {
        todayCheckIns: todayCheckInsCount,
        todayCheckOuts: todayCheckOutsCount,
        guestsStayingNow: guestsStayingNowCount,
        lateCheckOuts: lateCheckOutsCount
      }
    };
  }
}

export const bookingService = new BookingService();
