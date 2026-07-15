import { propertyRepository } from '../repositories/PropertyRepository';
import { prisma } from '../../../database/prisma';
import { pricingService } from './PricingService';

export class PropertyService {
  async calculatePrice(roomId: string, propertyId: string, dateString: string): Promise<number> {
    const rooms = await propertyRepository.findRoomsByPropertyId(propertyId);
    const room = rooms.find(r => r.id === roomId);
    if (!room) return 0;
    
    const override = (await propertyRepository.getAvailabilities(roomId)).find(o => o.date === dateString);
    if (override?.priceOverride) return override.priceOverride;

    const peaks = await propertyRepository.getPeakRates(propertyId);
    const peak = this.findPeakForDate(peaks, dateString);
    return peak ? Math.round(room.basePrice * Number(peak.rateMultiplier)) : room.basePrice;
  }

  private findPeakForDate(peaks: any[], date: string) {
    return peaks.filter(p => p.isActive !== false).find(p => date >= p.startDate && date <= p.endDate);
  }

  async calculateTotalQuote(propertyId: string, roomId: string, start: string, end: string) {
    return pricingService.calculateQuote(propertyId, roomId, start, end);
  }

  private diffDays(start: string, end: string): number {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }

  private async resolveCategoryId(categoryId?: string | null) {
    if (categoryId) return categoryId;
    const firstCat = await prisma.propertyCategory.findFirst();
    if (firstCat) return firstCat.id;
    const newCat = await prisma.propertyCategory.create({
      data: { name: 'Villas', slug: 'villas' }
    });
    return newCat.id;
  }

  private toSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private buildPropertyFields(tenantId: string, categoryId: string, data: any) {
    const propName = data.name || 'Untitled Property';
    const draftIdSuffix = data.id ? `-${data.id}` : `-${Date.now()}`;
    return {
      name: propName,
      slug: (this.toSlug(propName) || 'untitled') + draftIdSuffix,
      description: data.description || 'Elegant StayEase suite.',
      categoryId,
      tenantId,
      location: data.location || (data.city && data.province ? `${data.city}, ${data.province}` : 'Jakarta, Indonesia'),
      city: data.city || 'Jakarta',
      province: data.province || 'DKI Jakarta',
      address: data.address || data.fullAddress || '',
      latitude: data.latitude ? parseFloat(data.latitude.toString()) : -8.7209,
      longitude: data.longitude ? parseFloat(data.longitude.toString()) : 115.1691,
      beds: data.beds ? parseInt(data.beds.toString()) : 1,
      baths: data.baths ? parseFloat(data.baths.toString()) : 1.0,
      sqft: data.sqft ? parseInt(data.sqft.toString()) : 100,
      basePrice: data.basePrice ? parseInt(data.basePrice.toString()) : 0,
      imageUrls: data.imageUrls || [],
      amenities: data.amenities || [],
      cleaningFee: data.cleaningFee ? parseInt(data.cleaningFee.toString()) : 0,
      serviceFee: data.serviceFee ? parseInt(data.serviceFee.toString()) : 0,
      securityDeposit: data.securityDeposit ? parseInt(data.securityDeposit.toString()) : 0,
      guests: data.guests ? parseInt(data.guests.toString()) : 1,
      status: data.status || 'ACTIVE',
      currentWizardStep: data.currentWizardStep ? parseInt(data.currentWizardStep.toString()) : 1,
      progressPercentage: data.progressPercentage ? parseInt(data.progressPercentage.toString()) : 0
    };
  }

  private async savePropertyImages(propertyId: string, urls: string[]) {
    if (!urls || !Array.isArray(urls)) return;
    await Promise.all(
      urls.map((url, i) =>
        prisma.propertyImage.create({
          data: { propertyId, url, isCover: i === 0 }
        })
      )
    );
  }

  private async createDefaultRoom(propertyId: string, basePrice: number, guests: number) {
    await prisma.room.create({
      data: {
        propertyId,
        name: 'Standard Room',
        type: 'Standard',
        capacity: guests,
        basePrice,
        status: 'Available'
      }
    });
  }

  async saveRooms(propertyId: string, rooms: any[]) {
    if (!rooms || !Array.isArray(rooms)) return;
    
    // 1. Get existing rooms from DB
    const existingRooms = await prisma.room.findMany({
      where: { propertyId, deletedAt: null }
    });
    
    const existingIds = existingRooms.map(r => r.id);
    const updatedIds = rooms.map(r => r.id).filter(Boolean) as string[];
    
    // 2. Identify rooms to delete (soft-delete)
    const toDelete = existingIds.filter(id => !updatedIds.includes(id));
    if (toDelete.length > 0) {
      await prisma.room.updateMany({
        where: { id: { in: toDelete } },
        data: { deletedAt: new Date() }
      });
    }
    
    // 3. Create or update rooms
    for (const room of rooms) {
      const roomData = {
        name: room.name || 'Standard Room',
        type: room.type || 'Standard',
        capacity: parseInt(room.capacity?.toString() || '2'),
        basePrice: parseInt(room.basePrice?.toString() || room.pricePerNight?.toString() || '500000'),
        status: (room.status || 'Available') as any,
        wing: room.description || room.wing || '',
        floor: JSON.stringify({
          bedCount: parseInt(room.bedCount?.toString() || '1'),
          bathCount: parseInt(room.bathCount?.toString() || '1'),
          quantity: parseInt(room.quantity?.toString() || '1')
        }),
        image: room.image || (room.images && room.images[0]) || (room.imageUrls && room.imageUrls[0]) || ''
      };
      
      if (room.id && existingIds.includes(room.id)) {
        // Update existing room
        await prisma.room.update({
          where: { id: room.id },
          data: roomData
        });
      } else {
        // Create new room for this property
        await prisma.room.create({
          data: {
            ...roomData,
            propertyId
          }
        });
      }
    }
  }

  async createProperty(tenantId: string, data: any) {
    const categoryId = await this.resolveCategoryId(data.categoryId);
    const fields = this.buildPropertyFields(tenantId, categoryId, data);
    const created = await propertyRepository.createProperty(fields);
    await this.savePropertyImages(created.id, data.imageUrls);
    if (data.rooms && data.rooms.length > 0) {
      await this.saveRooms(created.id, data.rooms);
    } else {
      await this.createDefaultRoom(created.id, fields.basePrice, fields.guests);
    }
    return created;
  }

  private numericConversions(fields: any, data: any) {
    if (data.latitude !== undefined) fields.latitude = parseFloat(data.latitude.toString());
    if (data.longitude !== undefined) fields.longitude = parseFloat(data.longitude.toString());
    if (data.beds !== undefined) fields.beds = parseInt(data.beds.toString());
    if (data.baths !== undefined) fields.baths = parseFloat(data.baths.toString());
    if (data.sqft !== undefined) fields.sqft = parseInt(data.sqft.toString());
    if (data.basePrice !== undefined) fields.basePrice = parseInt(data.basePrice.toString());
    if (data.cleaningFee !== undefined) fields.cleaningFee = parseInt(data.cleaningFee.toString());
    if (data.serviceFee !== undefined) fields.serviceFee = parseInt(data.serviceFee.toString());
    if (data.securityDeposit !== undefined) fields.securityDeposit = parseInt(data.securityDeposit.toString());
    if (data.guests !== undefined) fields.guests = parseInt(data.guests.toString());
    if (data.currentWizardStep !== undefined) fields.currentWizardStep = parseInt(data.currentWizardStep.toString());
    if (data.progressPercentage !== undefined) fields.progressPercentage = parseInt(data.progressPercentage.toString());
  }

  private buildUpdateFields(data: any) {
    const fields: any = {};
    const keys = [
      'name', 'description', 'categoryId', 'location', 'city', 'province',
      'beds', 'baths', 'sqft', 'basePrice', 'imageUrls', 'amenities',
      'cleaningFee', 'serviceFee', 'securityDeposit', 'guests', 'status',
      'currentWizardStep', 'progressPercentage'
    ];
    for (const key of keys) {
      if (data[key] !== undefined) fields[key] = data[key];
    }
    if (data.name !== undefined) {
      fields.slug = this.toSlug(data.name) + '-' + (data.id || Date.now());
    }
    if (data.address !== undefined || data.fullAddress !== undefined) {
      fields.address = data.address || data.fullAddress || '';
    }
    this.numericConversions(fields, data);
    return fields;
  }

  async updateProperty(id: string, data: any) {
    const fields = this.buildUpdateFields(data);
    const updated = await propertyRepository.updateProperty(id, fields);
    if (data.rooms) {
      await this.saveRooms(id, data.rooms);
    }
    return updated;
  }

  async upsertPropertyDraft(tenantId: string, data: any) {
    const categoryId = await this.resolveCategoryId(data.categoryId);
    const fields = {
      ...this.buildPropertyFields(tenantId, categoryId, data),
      id: data.id || undefined
    };

    // If an ID was supplied, check if the record exists to decide on update or create
    let exists = false;
    if (fields.id) {
      const existing = await prisma.property.findUnique({
        where: { id: fields.id }
      });
      if (existing) exists = true;
    }

    let result: any;
    if (exists && fields.id) {
      result = await prisma.property.update({
        where: { id: fields.id },
        data: fields
      });
    } else {
      result = await prisma.property.create({
        data: fields
      });
    }

    if (data.imageUrls && data.imageUrls.length > 0) {
      await prisma.propertyImage.deleteMany({
        where: { propertyId: result.id }
      });
      await this.savePropertyImages(result.id, data.imageUrls);
    }

    if (data.rooms) {
      await this.saveRooms(result.id, data.rooms);
    }

    return result;
  }

  async deleteProperty(id: string) {
    return propertyRepository.deleteProperty(id);
  }
}

export const propertyService = new PropertyService();

