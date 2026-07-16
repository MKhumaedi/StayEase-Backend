import { prisma } from '../../../database/prisma';

export function parseRoomQuantity(room: any): number {
  let quantity = 1;
  try {
    if (room.floor && room.floor.trim().startsWith('{')) {
      const parsed = JSON.parse(room.floor);
      if (parsed && typeof parsed.quantity === 'number') {
        quantity = parsed.quantity;
      } else if (parsed && parsed.quantity) {
        const qty = parseInt(parsed.quantity);
        if (!isNaN(qty)) quantity = qty;
      }
    }
  } catch (e) {}
  return quantity;
}

export async function calculateRoomActiveBookings(roomId: string, checkIn: string, checkOut: string): Promise<number> {
  const count = await prisma.booking.count({
    where: {
      roomId,
      deletedAt: null,
      status: { in: ['CONFIRMED', 'CHECKED_IN', 'WAITING_PAYMENT'] },
      AND: [
        { startDate: { lt: checkOut } },
        { endDate: { gt: checkIn } }
      ]
    }
  });
  return count;
}

export class PropertyRepository {
  async findById(id: string) {
    return prisma.property.findFirst({
      where: { id, deletedAt: null },
      include: { 
        category: true,
        tenant: {
          select: {
            id: true,
            name: true,
            avatarUrl: true
          }
        }
      }
    });
  }

  async findBySlug(slug: string) {
    return prisma.property.findFirst({
      where: { slug, deletedAt: null },
      include: { 
        category: true,
        tenant: {
          select: {
            id: true,
            name: true,
            avatarUrl: true
          }
        }
      }
    });
  }

  async findRoomsByPropertyId(propertyId: string) {
    let resolvedId = propertyId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId);
    if (!isUuid) {
      const prop = await this.findBySlug(propertyId);
      if (prop) resolvedId = prop.id;
    }
    return prisma.room.findMany({
      where: { propertyId: resolvedId, deletedAt: null }
    });
  }

  async getAvailabilities(roomId: string) {
    return prisma.roomAvailability.findMany({
      where: { roomId, deletedAt: null }
    });
  }

  async getPeakRates(propertyId: string) {
    let resolvedId = propertyId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId);
    if (!isUuid) {
      const prop = await this.findBySlug(propertyId);
      if (prop) resolvedId = prop.id;
    }
    return prisma.peakSeasonRate.findMany({
      where: { propertyId: resolvedId, deletedAt: null }
    });
  }

  async createProperty(data: any) {
    return prisma.property.create({ data });
  }

  async updateProperty(id: string, data: any) {
    return prisma.property.update({ where: { id }, data });
  }

  async delete(id: string) {
    try {
      await prisma.favorite.deleteMany({
        where: { propertyId: id }
      });
    } catch (e) {
      console.error('[PropertyRepository.delete] Error cleaning up related favorites:', e);
    }

    return prisma.property.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }

  async deleteProperty(id: string) {
    return this.delete(id);
  }

  async restore(id: string) {
    return prisma.property.update({
      where: { id },
      data: { deletedAt: null }
    });
  }

  async restoreProperty(id: string) {
    return this.restore(id);
  }

  async bulkUpdateAvailability(
    roomId: string,
    dates: string[],
    isBlocked: boolean,
    priceOverride?: number
  ): Promise<void> {
    await Promise.all(dates.map(date => 
      prisma.roomAvailability.upsert({
        where: { roomId_date: { roomId, date } },
        update: { isBlocked, priceOverride: priceOverride || null, deletedAt: null },
        create: { roomId, date, isBlocked, priceOverride: priceOverride || null }
      })
    ));
  }

  private addPriceRange(where: any, min?: number, max?: number) {
    if (!min && !max) return;
    const bp: any = {};
    if (min) bp.gte = min;
    if (max) bp.lte = max;
    where.basePrice = bp;
  }

  private buildQueryWhere(f: any) {
    const andConditions: any[] = [{ deletedAt: null }];

    if (f.tenantId) {
      andConditions.push({ tenantId: f.tenantId });
    } else {
      andConditions.push({ status: { in: ['ACTIVE', 'PUBLISHED'] } });
    }

    if (f.city && f.city !== 'All') {
      andConditions.push({
        OR: [
          { city: { equals: f.city, mode: 'insensitive' } },
          { location: { startsWith: f.city, mode: 'insensitive' } },
          { location: { startsWith: f.city + ',', mode: 'insensitive' } }
        ]
      });
    }

    if (f.category && f.category !== '') {
      const categoryTerms: string[] = [];
      if (f.category === 'cat-luxury' || f.category === 'luxury-villas' || f.category === 'cat-1') {
        categoryTerms.push('luxury-villas');
      } else if (f.category === 'cat-apartment' || f.category === 'penthouses' || f.category === 'cat-2') {
        categoryTerms.push('penthouses');
      } else if (f.category === 'cabins' || f.category === 'cat-3') {
        categoryTerms.push('cabins');
      } else {
        categoryTerms.push(f.category);
      }

      andConditions.push({
        category: {
          OR: [
            { id: { in: categoryTerms } },
            { slug: { in: categoryTerms } },
            { name: { in: categoryTerms } }
          ]
        }
      });
    }

    if (f.search) {
      andConditions.push({
        OR: [
          { name: { contains: f.search, mode: 'insensitive' } },
          { city: { contains: f.search, mode: 'insensitive' } },
          { province: { contains: f.search, mode: 'insensitive' } },
          { location: { contains: f.search, mode: 'insensitive' } },
          { description: { contains: f.search, mode: 'insensitive' } },
          { category: { name: { contains: f.search, mode: 'insensitive' } } }
        ]
      });
    }

    if (f.minPrice !== undefined || f.maxPrice !== undefined) {
      const min = f.minPrice;
      const max = f.maxPrice;

      const scaledBp: any = { lt: 50000 };
      if (min !== undefined) scaledBp.gte = min;
      if (max !== undefined) scaledBp.lte = max;

      const unscaledBp: any = { gte: 50000 };
      if (min !== undefined) {
        if (min < 50000) {
          unscaledBp.gte = min * 1000;
        } else {
          unscaledBp.gte = min;
        }
      }
      if (max !== undefined) {
        if (max < 50000) {
          unscaledBp.lte = max * 1000;
        } else {
          unscaledBp.lte = max;
        }
      }

      andConditions.push({
        OR: [
          { basePrice: scaledBp },
          { basePrice: unscaledBp }
        ]
      });
    }

    if (f.amenities?.length) {
      andConditions.push({
        amenities: { hasEvery: f.amenities }
      });
    }

    // Capacity and check-in date availability checks
    let stayDates: string[] = [];
    if (f.checkIn && f.checkIn.trim() !== '') {
      const duration = f.duration || 1;
      const date = new Date(f.checkIn);
      const dates: string[] = [];
      for (let i = 0; i < duration; i++) {
        try {
          const dStr = date.toISOString().split('T')[0];
          dates.push(dStr);
        } catch (e) {}
        date.setDate(date.getDate() + 1);
      }
      if (dates.length > 0) {
        stayDates = dates;
      }
    }

    const roomConditions: any = { deletedAt: null };

    if (f.guests !== undefined && f.guests > 0) {
      roomConditions.capacity = { gte: f.guests };
    }

    if (stayDates.length > 0) {
      roomConditions.NOT = roomConditions.NOT || [];
      roomConditions.NOT.push({
        availabilities: {
          some: {
            date: { in: stayDates },
            isBlocked: true,
            deletedAt: null
          }
        }
      });
    }

    if ((f.guests !== undefined && f.guests > 0) || stayDates.length > 0) {
      andConditions.push({
        rooms: {
          some: roomConditions
        }
      });
    }

    return { AND: andConditions };
  }

  private buildOrderBy(sort?: string) {
    if (sort === 'price_asc' || sort === 'price ASC') return { basePrice: 'asc' as const };
    if (sort === 'price_desc' || sort === 'price DESC') return { basePrice: 'desc' as const };
    if (sort === 'rating_desc' || sort === 'rating DESC') return { rating: 'desc' as const };
    if (sort === 'reviews_desc' || sort === 'review_desc' || sort === 'reviewCount DESC') return { reviewCount: 'desc' as const };
    if (sort === 'created_desc' || sort === 'newest' || sort === 'createdAt DESC') return { createdAt: 'desc' as const };
    if (sort === 'name_asc' || sort === 'name ASC') return { name: 'asc' as const };
    if (sort === 'name_desc' || sort === 'name DESC') return { name: 'desc' as const };
    return { createdAt: 'desc' as const };
  }

  private async fetchPage(where: any, page: number, limit: number, sort?: string) {
    return prisma.property.findMany({
      where,
      orderBy: this.buildOrderBy(sort),
      include: { 
        category: true,
        rooms: {
          where: { deletedAt: null }
        }
      }
    });
  }

  async search(filters: {
    category?: string;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    amenities?: string[];
    sort?: string;
    page?: number;
    limit?: number;
    city?: string;
    checkIn?: string;
    duration?: number;
    guests?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const where = this.buildQueryWhere(filters);
    
    // Fetch all matching properties from database to filter based on check-in date and exact available inventory
    const allMatchedProperties = await prisma.property.findMany({
      where,
      orderBy: this.buildOrderBy(filters.sort),
      include: { 
        category: true,
        rooms: {
          where: { deletedAt: null }
        }
      }
    });

    // Parse filters
    let requestedStartDate: string | undefined = filters.checkIn;
    let requestedEndDate: string | undefined;
    if (requestedStartDate && requestedStartDate.trim() !== '') {
      const duration = filters.duration || 1;
      const date = new Date(requestedStartDate);
      date.setDate(date.getDate() + duration);
      try {
        requestedEndDate = date.toISOString().split('T')[0];
      } catch (e) {}
    }

    const filteredProperties: any[] = [];

    for (const property of allMatchedProperties) {
      let hasAtLeastOneMatchingRoom = false;
      const enrichedRooms: any[] = [];

      for (const room of property.rooms) {
        // Filter by capacity
        if (filters.guests !== undefined && filters.guests > 0) {
          if (room.capacity < filters.guests) {
            continue;
          }
        }

        let isAvailable = true;
        let activeBookingCount = 0;
        const quantity = parseRoomQuantity(room);
        let blocked = null;

        if (requestedStartDate && requestedEndDate) {
          // 1. Check if blocked in RoomAvailability
          blocked = await prisma.roomAvailability.findFirst({
            where: {
              roomId: room.id,
              isBlocked: true,
              deletedAt: null,
              date: { gte: requestedStartDate, lt: requestedEndDate }
            }
          });

          // 2. Count active bookings overlapping the dates
          activeBookingCount = await calculateRoomActiveBookings(
            room.id,
            requestedStartDate,
            requestedEndDate
          );

          if (blocked || (quantity - activeBookingCount) <= 0) {
            isAvailable = false;
          }
        }

        const dbStatus = room.status;
        const isBlocked = !!blocked;
        const isManuallyDisabled = (dbStatus as string) === 'Maintenance' || (dbStatus as string) === 'Unavailable' || dbStatus === 'UNAVAILABLE' || isBlocked;

        const bookedRooms = activeBookingCount;
        const remainingRooms = Math.max(0, quantity - bookedRooms);

        let availabilityStatus = 'Tersedia';
        if (isManuallyDisabled) {
          availabilityStatus = 'Tidak Tersedia';
        } else if (remainingRooms === 0) {
          availabilityStatus = 'Penuh';
        } else if (remainingRooms <= 0.2 * quantity) {
          availabilityStatus = 'Hampir Habis';
        } else {
          availabilityStatus = 'Tersedia';
        }

        const updatedStatus = isAvailable ? 'Available' : 'Occupied';
        
        enrichedRooms.push({
          ...room,
          dbStatus,
          quantity,
          bookedRooms,
          remainingRooms,
          activeBookingCount,
          isBlocked,
          isManuallyDisabled,
          availabilityStatus,
          status: updatedStatus
        });

        if (isAvailable) {
          hasAtLeastOneMatchingRoom = true;
        }
      }

      // Keep property if there's no check-in/guests filters OR if we found at least one matching available room
      const needsRoomFiltering = (filters.guests !== undefined && filters.guests > 0) || (requestedStartDate !== undefined && requestedStartDate.trim() !== '');
      if (!needsRoomFiltering || hasAtLeastOneMatchingRoom) {
        filteredProperties.push({
          ...property,
          rooms: enrichedRooms
        });
      }
    }

    const total = filteredProperties.length;
    const startIndex = (page - 1) * limit;
    const paginatedData = filteredProperties.slice(startIndex, startIndex + limit);

    return { data: paginatedData, total };
  }

  async save(prop: any) {
    return prisma.property.upsert({
      where: { id: prop.id },
      update: prop,
      create: prop
    });
  }
}

export const propertyRepository = new PropertyRepository();
