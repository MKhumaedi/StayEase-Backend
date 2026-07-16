import { bookingRepository } from '../repositories/BookingRepository';
import { propertyService } from '../../properties/services/PropertyService';
import { propertyRepository, parseRoomQuantity, calculateRoomActiveBookings } from '../../properties/repositories/PropertyRepository';
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
    const room = await prisma.room.findUnique({
      where: { id: roomId }
    });
    if (!room) throw new Error('Room not found');

    const quantity = parseRoomQuantity(room);
    const activeBookingCount = await prisma.booking.count({
      where: {
        roomId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
        deletedAt: null,
        NOT: excludeId ? { id: excludeId } : undefined,
        AND: [
          { startDate: { lt: end } },
          { endDate: { gt: start } }
        ]
      }
    });

    if (activeBookingCount >= quantity) {
      throw new Error('This room is already fully booked for the selected dates.');
    }
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

  async getReportStats(
    landlordId?: string,
    propertyId?: string,
    period?: string,
    startDate?: string,
    endDate?: string
  ) {
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
        },
        operations: {
          todayCheckIns: 0,
          todayCheckOuts: 0,
          guestsStayingNow: 0,
          lateCheckOuts: 0
        },
        totalRevenueAllTime: 0,
        todayRevenue: 0,
        thisWeekRevenue: 0,
        thisMonthRevenue: 0,
        thisYearRevenue: 0,
        adr: 0,
        revpar: 0,
        averageLengthOfStay: 0,
        averageBookingLeadTime: 0,
        properties: []
      };
    }

    const SUCCESSFUL_STATUSES: BookingStatus[] = [
      BookingStatus.CONFIRMED,
      BookingStatus.CHECKED_IN,
      BookingStatus.CHECKED_OUT,
      BookingStatus.COMPLETED
    ];

    // 1. Fetch properties for this landlord
    const tenantProperties = await prisma.property.findMany({
      where: { tenantId: landlordId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' }
    });

    const totalProperties = tenantProperties.length;

    // Fetch rooms count
    const activeRoomsCount = await prisma.room.count({
      where: {
        deletedAt: null,
        property: {
          tenantId: landlordId,
          deletedAt: null
        }
      }
    });

    // Let's fetch all properties with rooms, bookings, and reviews for other standard stats
    const propertiesWithData = await prisma.property.findMany({
      where: { tenantId: landlordId, deletedAt: null },
      select: {
        id: true,
        name: true,
        rooms: {
          where: { deletedAt: null },
          select: { id: true }
        },
        bookings: {
          where: { deletedAt: null },
          select: {
            id: true,
            status: true,
            createdAt: true,
            totalAmount: true,
            nights: true,
            startDate: true,
            endDate: true
          }
        },
        reviews: {
          where: { deletedAt: null },
          select: { id: true }
        }
      }
    });

    // Flatten all bookings
    const allBookings = propertiesWithData.flatMap(p => p.bookings);

    // Standard monthly bookings (current calendar month, not deleted, not cancelled)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const startOfCurrentMonth = new Date(currentYear, currentMonth, 1);
    const endOfCurrentMonth = new Date(currentYear, currentMonth + 1, 1);

    const currentMonthBookings = allBookings.filter(b => {
      const matchStatus = b.status === 'CONFIRMED' || b.status === 'COMPLETED' || b.status === 'CHECKED_IN' || b.status === 'CHECKED_OUT';
      const createdDate = new Date(b.createdAt);
      return matchStatus && createdDate >= startOfCurrentMonth && createdDate < endOfCurrentMonth;
    });

    const totalRevenueMonth = currentMonthBookings.reduce((sum, b) => sum + Number(b.totalAmount), 0);

    const monthlyBookings = allBookings.filter(b => {
      const createdDate = new Date(b.createdAt);
      return createdDate >= startOfCurrentMonth && createdDate < endOfCurrentMonth && b.status !== 'CANCELLED';
    }).length;

    const bookedRoomNights = currentMonthBookings.reduce((sum, b) => sum + b.nights, 0);
    const availableRoomNights = activeRoomsCount * daysInMonth;
    const occupancyRateMonth = availableRoomNights > 0 
      ? Number(((bookedRoomNights / availableRoomNights) * 100).toFixed(1))
      : 0.0;

    const pendingOrders = allBookings.filter(b => b.status === 'WAITING_CONFIRMATION').length;
    const newReviews = propertiesWithData.reduce((acc, p) => acc + p.reviews.length, 0);

    // Dynamic Filter Range Calculations
    let filterStart: Date;
    let filterEnd: Date;
    const todayDate = new Date();

    if (period === 'today') {
      filterStart = new Date();
      filterStart.setHours(0, 0, 0, 0);
      filterEnd = new Date();
      filterEnd.setHours(23, 59, 59, 999);
    } else if (period === 'this_week') {
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      filterStart = new Date(d.setDate(diff));
      filterStart.setHours(0, 0, 0, 0);
      filterEnd = new Date(filterStart);
      filterEnd.setDate(filterEnd.getDate() + 7);
      filterEnd.setHours(23, 59, 59, 999);
    } else if (period === 'this_month') {
      filterStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
      filterEnd = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0);
      filterEnd.setHours(23, 59, 59, 999);
    } else if (period === 'this_year') {
      filterStart = new Date(todayDate.getFullYear(), 0, 1);
      filterEnd = new Date(todayDate.getFullYear(), 11, 31);
      filterEnd.setHours(23, 59, 59, 999);
    } else if (period === 'custom' && startDate && endDate) {
      filterStart = new Date(startDate + 'T00:00:00');
      filterEnd = new Date(endDate + 'T23:59:59');
    } else {
      // Default to this year
      filterStart = new Date(todayDate.getFullYear(), 0, 1);
      filterEnd = new Date(todayDate.getFullYear(), 11, 31);
      filterEnd.setHours(23, 59, 59, 999);
    }

    // Filter active bookings for current landlord & target property (if any)
    const successBookings = await prisma.booking.findMany({
      where: {
        deletedAt: null,
        status: { in: SUCCESSFUL_STATUSES },
        propertyId: propertyId || undefined,
        property: {
          tenantId: landlordId,
          deletedAt: null
        }
      }
    });

    // 2. Compute dynamic metrics:
    // Total Revenue (all-time of successful bookings)
    const totalRevenueAllTime = successBookings.reduce((sum, b) => sum + Number(b.totalAmount), 0);

    // Today's Revenue
    const todayS = new Date(); todayS.setHours(0,0,0,0);
    const todayE = new Date(); todayE.setHours(23,59,59,999);
    const todayRevenue = successBookings
      .filter(b => {
        const d = new Date(b.createdAt);
        return d >= todayS && d <= todayE;
      })
      .reduce((sum, b) => sum + Number(b.totalAmount), 0);

    // This Week Revenue
    const dW = new Date();
    const dayW = dW.getDay();
    const diffW = dW.getDate() - dayW + (dayW === 0 ? -6 : 1);
    const weekS = new Date(dW.setDate(diffW)); weekS.setHours(0,0,0,0);
    const weekE = new Date(weekS); weekE.setDate(weekE.getDate() + 7);
    const thisWeekRevenue = successBookings
      .filter(b => {
        const d = new Date(b.createdAt);
        return d >= weekS && d < weekE;
      })
      .reduce((sum, b) => sum + Number(b.totalAmount), 0);

    // This Month Revenue
    const monthS = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
    const monthE = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 1);
    const thisMonthRevenue = successBookings
      .filter(b => {
        const d = new Date(b.createdAt);
        return d >= monthS && d < monthE;
      })
      .reduce((sum, b) => sum + Number(b.totalAmount), 0);

    // This Year Revenue
    const yearS = new Date(todayDate.getFullYear(), 0, 1);
    const yearE = new Date(todayDate.getFullYear() + 1, 0, 1);
    const thisYearRevenue = successBookings
      .filter(b => {
        const d = new Date(b.createdAt);
        return d >= yearS && d < yearE;
      })
      .reduce((sum, b) => sum + Number(b.totalAmount), 0);

    // Dynamic period filtering
    const filteredBookings = successBookings.filter(b => {
      const d = new Date(b.createdAt);
      return d >= filterStart && d <= filterEnd;
    });

    const filteredRevenue = filteredBookings.reduce((sum, b) => sum + Number(b.totalAmount), 0);
    const totalNights = filteredBookings.reduce((sum, b) => sum + b.nights, 0);

    const adr = totalNights > 0 ? Math.round(filteredRevenue / totalNights) : 0;

    // Occupancy logic for filtered period
    const filteredPropertyRoomsCount = await prisma.room.count({
      where: {
        deletedAt: null,
        propertyId: propertyId || undefined,
        property: {
          tenantId: landlordId,
          deletedAt: null
        }
      }
    });

    const diffMs = filterEnd.getTime() - filterStart.getTime();
    const daysInPeriod = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const availableRoomNightsInPeriod = filteredPropertyRoomsCount * daysInPeriod;
    const occupancyRate = availableRoomNightsInPeriod > 0
      ? Math.min(100.0, Number(((totalNights / availableRoomNightsInPeriod) * 100).toFixed(1)))
      : 0.0;

    const revpar = Math.round(adr * (occupancyRate / 100));

    const averageLengthOfStay = filteredBookings.length > 0
      ? Number((totalNights / filteredBookings.length).toFixed(1))
      : 0.0;

    // Average booking lead time
    const leadTimes = filteredBookings.map(b => {
      const created = new Date(b.createdAt).getTime();
      const start = new Date(b.startDate + 'T00:00:00').getTime();
      return Math.max(0, Math.ceil((start - created) / (1000 * 60 * 60 * 24)));
    });
    const averageBookingLeadTime = leadTimes.length > 0
      ? Math.round(leadTimes.reduce((sum, t) => sum + t, 0) / leadTimes.length)
      : 0;

    // 3. Dynamic aggregated charts: daily or monthly
    const revenueAnalytics = [];
    const totalDays = Math.ceil((filterEnd.getTime() - filterStart.getTime()) / (1000 * 60 * 60 * 24));

    if (totalDays <= 31) {
      // Daily aggregates
      for (let d = new Date(filterStart); d <= filterEnd; d.setDate(d.getDate() + 1)) {
        const startOfDay = new Date(d); startOfDay.setHours(0,0,0,0);
        const endOfDay = new Date(d); endOfDay.setHours(23,59,59,999);

        const dayBookings = filteredBookings.filter(b => {
          const created = new Date(b.createdAt);
          return created >= startOfDay && created <= endOfDay;
        });

        const dayRev = dayBookings.reduce((sum, b) => sum + Number(b.totalAmount), 0);
        const dayNights = dayBookings.reduce((sum, b) => sum + b.nights, 0);
        const dayAvgLos = dayBookings.length > 0 ? Number((dayNights / dayBookings.length).toFixed(1)) : 0;

        const dayOfWeekStr = startOfDay.toLocaleDateString('en-US', { weekday: 'short' });
        const dayStr = startOfDay.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
        const label = `${dayOfWeekStr} ${dayStr}`;

        const dayAvail = filteredPropertyRoomsCount * 1;
        const dayOcc = dayAvail > 0 ? Math.min(100.0, Number(((dayNights / dayAvail) * 100).toFixed(1))) : 0.0;
        const target = Math.round(dayRev > 0 ? dayRev * 1.15 : (filteredPropertyRoomsCount * 500000 * 0.6));

        revenueAnalytics.push({
          month: label, // Compatible with standard frontend charts
          label,
          amt: dayRev,
          revenue: dayRev,
          target,
          bookings: dayBookings.length,
          lengthOfStay: dayAvgLos,
          rate: dayOcc,
          weekendRate: Math.min(100.0, Number((dayOcc * 1.15).toFixed(1))),
          leadTime: dayBookings.length > 0 ? Math.round(dayBookings.reduce((sum, b) => {
            const c = new Date(b.createdAt).getTime();
            const s = new Date(b.startDate + 'T00:00:00').getTime();
            return sum + Math.max(0, Math.ceil((s - c) / (1000 * 60 * 60 * 24)));
          }, 0) / dayBookings.length) : 0,
          adr: dayNights > 0 ? Math.round(dayRev / dayNights) : 0
        });
      }
    } else {
      // Monthly aggregates
      let currentMonthCursor = new Date(filterStart.getFullYear(), filterStart.getMonth(), 1);
      while (currentMonthCursor <= filterEnd) {
        const nextMonthCursor = new Date(currentMonthCursor.getFullYear(), currentMonthCursor.getMonth() + 1, 1);
        const startOfM = currentMonthCursor > filterStart ? currentMonthCursor : filterStart;
        const endOfM = nextMonthCursor < filterEnd ? nextMonthCursor : filterEnd;

        const monthBookings = filteredBookings.filter(b => {
          const created = new Date(b.createdAt);
          return created >= startOfM && created < endOfM;
        });

        const monthRev = monthBookings.reduce((sum, b) => sum + Number(b.totalAmount), 0);
        const monthNights = monthBookings.reduce((sum, b) => sum + b.nights, 0);
        const monthAvgLos = monthBookings.length > 0 ? Number((monthNights / monthBookings.length).toFixed(1)) : 0;

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const label = `${monthNames[startOfM.getMonth()]} ${startOfM.getFullYear().toString().slice(-2)}`;

        const daysInThisSegment = Math.max(1, Math.ceil((endOfM.getTime() - startOfM.getTime()) / (1000 * 60 * 60 * 24)));
        const segmentAvail = filteredPropertyRoomsCount * daysInThisSegment;
        const monthOcc = segmentAvail > 0 ? Math.min(100.0, Number(((monthNights / segmentAvail) * 100).toFixed(1))) : 0.0;
        const target = Math.round(monthRev > 0 ? monthRev * 1.15 : (filteredPropertyRoomsCount * daysInThisSegment * 500000 * 0.6));

        revenueAnalytics.push({
          month: label,
          label,
          amt: monthRev,
          revenue: monthRev,
          target,
          bookings: monthBookings.length,
          lengthOfStay: monthAvgLos,
          rate: monthOcc,
          weekendRate: Math.min(100.0, Number((monthOcc * 1.15).toFixed(1))),
          leadTime: monthBookings.length > 0 ? Math.round(monthBookings.reduce((sum, b) => {
            const c = new Date(b.createdAt).getTime();
            const s = new Date(b.startDate + 'T00:00:00').getTime();
            return sum + Math.max(0, Math.ceil((s - c) / (1000 * 60 * 60 * 24)));
          }, 0) / monthBookings.length) : 0,
          adr: monthNights > 0 ? Math.round(monthRev / monthNights) : 0
        });

        currentMonthCursor = nextMonthCursor;
      }
    }

    // Backward-compatible MoM Growth rate for Overview Tab
    const curMonthRev = thisMonthRevenue;
    const prevMonthS = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1);
    const prevMonthE = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
    const prevMonthBookings = successBookings.filter(b => {
      const d = new Date(b.createdAt);
      return d >= prevMonthS && d < prevMonthE;
    });
    const prevMonthRev = prevMonthBookings.reduce((sum, b) => sum + Number(b.totalAmount), 0);
    const growthRate = prevMonthRev > 0 
      ? Number((((curMonthRev - prevMonthRev) / prevMonthRev) * 100).toFixed(1))
      : (curMonthRev > 0 ? 100.0 : 0.0);

    // Compute standard property performance (backward compatible)
    const performanceList = propertiesWithData.map(p => {
      const roomsCount = p.rooms.length;
      const confirmedBookings = p.bookings.filter(b => SUCCESSFUL_STATUSES.includes(b.status));
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

    // Operations metrics (backward compatible)
    const todayStr = new Date().toISOString().split('T')[0];
    const todayCheckInsCount = allBookings.filter(b => b.status === 'CONFIRMED' && b.startDate === todayStr).length;
    const todayCheckOutsCount = allBookings.filter(b => b.status === 'CHECKED_IN' && b.endDate === todayStr).length;
    const guestsStayingNowCount = allBookings.filter(b => b.status === 'CHECKED_IN').length;
    const lateCheckOutsCount = allBookings.filter(b => b.status === 'CHECKED_IN' && todayStr > b.endDate).length;

    return {
      // Main dashboard backwards-compatible fields
      totalRevenue: totalRevenueMonth, // monthly revenue for dashboard card
      occupancyRate: occupancyRateMonth, // monthly occupancy rate for dashboard card
      pendingOrders,
      newReviews,
      totalProperties,
      activeRooms: activeRoomsCount,
      monthlyBookings,
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
      },
      // New enriched Revenue Dashboard fields
      totalRevenueAllTime,
      todayRevenue,
      thisWeekRevenue,
      thisMonthRevenue,
      thisYearRevenue,
      adr,
      revpar,
      averageLengthOfStay,
      averageBookingLeadTime,
      properties: tenantProperties,
      revenueAnalytics
    };
  }

  async requestCheckout(id: string) {
    return bookingRepository.requestCheckOut(id);
  }

  async requestCheckOut(id: string) {
    return this.requestCheckout(id);
  }

  async confirmCheckout(id: string, userId: string) {
    return bookingRepository.confirmCheckOut(id, userId);
  }

  async confirmCheckOut(id: string, userId: string) {
    return this.confirmCheckout(id, userId);
  }
}

export const bookingService = new BookingService();
