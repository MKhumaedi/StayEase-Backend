import { Request, Response } from 'express';
import { propertyRepository } from '../repositories/PropertyRepository';
import { propertyService } from '../services/PropertyService';
import { PropertySearchSchema, CalendarBulkUpdateSchema, PropertyInputSchema } from '../validations/PropertyValidation';
import { prisma } from '../../../database/prisma';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { RoomStatus } from '@prisma/client';

export class PropertyController {
  private async autoInitializeProperties(): Promise<void> {
    try {
      console.log('--- Initializing default categories, properties, and rooms recursively ---');
      // 1. Create categories if none exist
      let categories = await prisma.propertyCategory.findMany();
      if (categories.length === 0) {
        const categoriesData = [
          { id: 'cat-1', name: 'Luxury Villas', slug: 'luxury-villas', description: 'Exclusive standalone luxury villas' },
          { id: 'cat-2', name: 'Penthouses', slug: 'penthouses', description: 'Skyline penthouses in major metropolitan areas' },
          { id: 'cat-3', name: 'Cabins', slug: 'cabins', description: 'Cozy and serene forest cabins' }
        ];
        await prisma.propertyCategory.createMany({ data: categoriesData });
        categories = await prisma.propertyCategory.findMany();
      }

      // Check if properties already exist
      const propCount = await prisma.property.count();
      if (propCount > 0) return;

      // Find or create a tenant user to host these properties
      let tenant = await prisma.user.findFirst({ where: { role: 'TENANT' } });
      if (!tenant) {
        // Create standard seeded host tenant
        const hashedPassword = await bcrypt.hash('StayEase2026!', 10);
        tenant = await prisma.user.create({
          data: {
            id: 'u-host-seed',
            email: 'tenant@stayease.com',
            name: 'Johnathan Doe',
            password: hashedPassword,
            role: 'TENANT',
            isVerified: true,
            avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=100&q=80'
          }
        });
      }

      const catMap = new Map(categories.map(c => [c.slug, c.id]));
      const catLuxuryId = catMap.get('luxury-villas') || categories[0].id;
      const catPenthouseId = catMap.get('penthouses') || categories[0].id;

      // Define default properties
      const defaultProperties = [
        {
          id: 'prop-1',
          name: 'Azure Horizon Villa',
          slug: 'azure-horizon-villa',
          location: 'Jakarta, DKI Jakarta',
          city: 'Jakarta',
          province: 'DKI Jakarta',
          description: 'Discover a curated collection of high-luxury properties and executive suites. Designed for seamless living and effortless travel.',
          categoryId: catLuxuryId,
          beds: 4,
          baths: 3,
          sqft: 3200,
          basePrice: 850000,
          imageUrls: ['https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=800&q=80'],
          amenities: ['Private Pool', 'Air Conditioning', 'Free WiFi', 'Gym & Wellness Studio', 'Ocean View'],
          tenantId: tenant.id
        },
        {
          id: 'prop-2',
          name: 'Tuscan Retreat',
          slug: 'tuscan-retreat',
          location: 'Bandung, Jawa Barat',
          city: 'Bandung',
          province: 'Jawa Barat',
          description: 'Authentic stone villa in the heart of Bandung with breathtaking vistas, infinity terrace, and curated classical architecture.',
          categoryId: catLuxuryId,
          beds: 6,
          baths: 5,
          sqft: 4500,
          basePrice: 1200000,
          imageUrls: ['https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=800&q=80'],
          amenities: ['Private Pool', 'Free WiFi', 'Climate-Controlled Wine Cellar', 'Pet Friendly'],
          tenantId: tenant.id
        },
        {
          id: 'prop-3',
          name: 'The Summit Penthouse',
          slug: 'the-summit-penthouse',
          location: 'Surabaya, Jawa Timur',
          city: 'Surabaya',
          province: 'Jawa Timur',
          description: 'Grave in-city sky residence featuring floor-to-ceiling panoramic views of Manhattan skyscrapers and central park.',
          categoryId: catPenthouseId,
          beds: 3,
          baths: 2,
          sqft: 2100,
          basePrice: 950000,
          imageUrls: ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80'],
          amenities: ['Free WiFi', 'Air Conditioning', 'Valet Parking Service', 'Gym & Wellness Studio'],
          tenantId: tenant.id
        },
        {
          id: 'prop-4',
          name: 'Skyline Loft',
          slug: 'skyline-loft',
          location: 'Yogyakarta, DI Yogyakarta',
          city: 'Yogyakarta',
          province: 'DI Yogyakarta',
          description: 'This property is part of our vetted luxury collection. Fully loaded with smart amenities, premium designer finishes, and sweeping city landscapes.',
          categoryId: catPenthouseId,
          beds: 4,
          baths: 4,
          sqft: 2800,
          basePrice: 1200000,
          imageUrls: ['https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80'],
          amenities: ['Infinity Pool', 'Private Chef (Available on request)', 'Gym & Wellness Studio', 'Fiber-Optic WiFi', 'Climate-Controlled Wine Cellar', 'Valet Parking Service'],
          tenantId: tenant.id
        }
      ];

      await prisma.property.createMany({ data: defaultProperties });

      // Create rooms for prop-4 (Skyline Loft) to support quoting & booking demo
      const defaultRooms = [
        {
          id: 'room-101',
          propertyId: 'prop-4',
          name: 'Suite 401',
          type: 'Master Suite',
          capacity: 2,
          basePrice: 450,
          status: 'AVAILABLE' as RoomStatus,
          wing: 'North Wing',
          floor: 'Floor 4'
        },
        {
          id: 'room-102',
          propertyId: 'prop-4',
          name: 'Studio 204',
          type: 'Studio',
          capacity: 1,
          basePrice: 210,
          status: 'UNAVAILABLE' as RoomStatus,
          wing: 'East Wing',
          floor: 'Floor 2'
        },
        {
          id: 'room-103',
          propertyId: 'prop-4',
          name: 'Deluxe 312',
          type: 'Deluxe Double',
          capacity: 4,
          basePrice: 345,
          status: 'UNAVAILABLE' as RoomStatus,
          wing: 'South Wing',
          floor: 'Floor 3'
        },
        {
          id: 'room-104',
          propertyId: 'prop-4',
          name: 'Suite 502',
          type: 'Executive Suite',
          capacity: 2,
          basePrice: 850,
          status: 'AVAILABLE' as RoomStatus,
          wing: 'Penthouse Level',
          floor: 'Floor 5'
        }
      ];

      await prisma.room.createMany({ data: defaultRooms });
      console.log('--- Successfully initialized default seed properties and rooms! ---');
    } catch (err: any) {
      console.error('Error auto-initializing properties:', err);
    }
  }

  private async autoAssignUnownedProperties(tenantId: string, tenantName: string): Promise<void> {
    const allProps = await prisma.property.findMany();
    const unowned = allProps.filter(p => !p.tenantId);
    if (unowned.length > 0) {
      console.log(`Auto-assigning ${unowned.length} unowned properties to tenant: ${tenantName}`);
      await Promise.all(unowned.map(p => 
        prisma.property.update({
          where: { id: p.id },
          data: { tenantId }
        })
      ));
    }
  }

  private async getTenantIdFromHeader(authHeader?: string): Promise<string | undefined> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return undefined;
    try {
      const token = authHeader.split(' ')[1];
      const JWT_SECRET = process.env.JWT_SECRET || 'stayease-secret-key-9021';
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (!decoded?.id) return undefined;
      const user = await prisma.user.findUnique({ where: { id: decoded.id } });
      if (user && user.role === 'TENANT') {
        await this.autoAssignUnownedProperties(user.id, user.name);
        return user.id;
      }
    } catch (e) {}
    return undefined;
  }

  private async checkPropertyAccess(property: any, authHeader?: string): Promise<boolean> {
    if (!property) return false;
    if (property.status === 'ACTIVE' || property.status === 'PUBLISHED') {
      return true;
    }
    const tenantId = await this.getTenantIdFromHeader(authHeader);
    return property.tenantId === tenantId;
  }

  async listProperties(req: Request, res: Response): Promise<void> {
    try {
      const tenantIdFilter = req.query.byTenant === 'true' 
        ? await this.getTenantIdFromHeader(req.headers.authorization)
        : undefined;
      const queryParams: any = { ...req.query };
      
      if (queryParams.maxPrice === '') delete queryParams.maxPrice;
      if (queryParams.minPrice === '') delete queryParams.minPrice;
      if (queryParams.category === '') delete queryParams.category;
      if (queryParams.search === '') delete queryParams.search;
      if (queryParams.checkIn === '') delete queryParams.checkIn;
      if (queryParams.duration === '') delete queryParams.duration;
      if (queryParams.guests === '') delete queryParams.guests;

      const validated = PropertySearchSchema.parse({
        ...queryParams,
        amenities: queryParams.amenities ? (queryParams.amenities as string).split(',') : undefined,
        tenantId: tenantIdFilter
      });
      const results = await propertyRepository.search(validated);

      // Dynamically calculate rating and reviewCount from the actual Review table for consistency and pure source of truth
      const checkInDateStr = validated.checkIn;
      
      const enrichedData = await Promise.all(results.data.map(async (property) => {
        const aggregate = await prisma.review.aggregate({
          where: { propertyId: property.id, deletedAt: null },
          _avg: { rating: true },
          _count: { id: true }
        });

        let adjustedBasePrice = Number(property.basePrice);
        let peakSeasonName: string | null = null;
        let peakMultiplier = 1.0;

        if (checkInDateStr) {
          const peakRates = await prisma.peakSeasonRate.findMany({
            where: {
              propertyId: property.id,
              deletedAt: null,
              isActive: true,
              startDate: { lte: checkInDateStr },
              endDate: { gte: checkInDateStr }
            }
          });
          if (peakRates.length > 0) {
            const match = peakRates.find(p => !p.roomId) || peakRates[0];
            if (match) {
              peakSeasonName = match.name;
              peakMultiplier = Number(match.rateMultiplier);
              adjustedBasePrice = Math.round(adjustedBasePrice * peakMultiplier);
            }
          }
        }

        return {
          ...property,
          rating: aggregate._avg.rating ? Math.round(Number(aggregate._avg.rating) * 100) / 100 : 0,
          reviewCount: aggregate._count.id || 0,
          originalBasePrice: Number(property.basePrice),
          basePrice: adjustedBasePrice,
          peakSeasonName,
          peakMultiplier
        };
      }));

      res.json({
        data: enrichedData,
        total: results.total
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async getProperty(req: Request, res: Response): Promise<void> {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id);
      const property = isUuid ? await propertyRepository.findById(req.params.id) : await propertyRepository.findBySlug(req.params.id);
      if (!property) return res.status(404).json({ error: 'Property not found' }) as any;
      const allowed = await this.checkPropertyAccess(property, req.headers.authorization);
      if (!allowed) return res.status(403).json({ error: 'Access denied: belongs to another host.' }) as any;
      const rooms = await propertyRepository.findRoomsByPropertyId(property.id);

      // Dynamically calculate rating and reviewCount from the actual Review table for consistency and pure source of truth
      const aggregate = await prisma.review.aggregate({
        where: { propertyId: property.id, deletedAt: null },
        _avg: { rating: true },
        _count: { id: true }
      });

      const enrichedProperty = {
        ...property,
        rating: aggregate._avg.rating ? Math.round(Number(aggregate._avg.rating) * 100) / 100 : 0,
        reviewCount: aggregate._count.id || 0
      };

      res.json({ property: enrichedProperty, rooms });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async getQuotes(req: Request, res: Response): Promise<void> {
    const { propertyId, roomId, start, end } = req.query;
    try {
      const quote = await propertyService.calculateTotalQuote(
        propertyId as string,
        roomId as string,
        start as string,
        end as string
      );
      res.json(quote);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async bulkUpdateCalendar(req: Request, res: Response): Promise<void> {
    try {
      const validated = CalendarBulkUpdateSchema.parse(req.body);
      await propertyRepository.bulkUpdateAvailability(
        validated.roomId,
        validated.dates,
        validated.isBlocked,
        validated.priceOverride
      );
      res.json({ success: true, message: 'Calendar updated successfully' });
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async createProperty(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.userId;
      if (!tenantId) return res.status(401).json({ error: 'Session required.' }) as any;
      const validatedData = PropertyInputSchema.parse(req.body);
      const created = await propertyService.createProperty(tenantId, validatedData);
      res.status(201).json({ success: true, property: created });
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async deleteProperty(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.userId;
      const existing = await prisma.property.findUnique({ where: { id: req.params.id } });
      if (!tenantId) return res.status(401).json({ error: 'Unauthorized' }) as any;
      if (!existing) return res.status(404).json({ error: 'Not found' }) as any;
      if (existing.tenantId !== tenantId) return res.status(403).json({ error: 'Forbidden' }) as any;
      const deleted = await propertyService.deleteProperty(req.params.id);
      res.json({ success: true, property: deleted });
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async updateProperty(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.userId;
      const role = req.userRole;
      const existing = await prisma.property.findUnique({ where: { id: req.params.id } });
      if (!tenantId) return res.status(401).json({ error: 'Unauthorized' }) as any;
      if (!existing) return res.status(404).json({ error: 'Not found' }) as any;
      if (existing.tenantId !== tenantId && role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' }) as any;
      const validatedData = PropertyInputSchema.partial().parse(req.body);
      const updated = await propertyService.updateProperty(req.params.id, validatedData);
      res.json({ success: true, property: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }
}

export const propertyController = new PropertyController();
