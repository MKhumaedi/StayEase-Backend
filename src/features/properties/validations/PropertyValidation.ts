import { z } from 'zod';

export const PropertySearchSchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  city: z.string().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  amenities: z.array(z.string()).optional(),
  sort: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).optional().default(10),
  tenantId: z.string().optional(),
  checkIn: z.string().optional(),
  duration: z.coerce.number().int().min(1).optional(),
  guests: z.coerce.number().int().min(1).optional()
});

export const PropertyInputSchema = z.object({
  name: z.string().min(1, 'Property name is required'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  categoryId: z.string().optional().nullable(),
  city: z.string().min(1, 'City is required'),
  province: z.string().min(1, 'Province is required'),
  address: z.string().optional().nullable(),
  fullAddress: z.string().optional().nullable(),
  latitude: z.coerce.number().optional().default(-8.7209),
  longitude: z.coerce.number().optional().default(115.1691),
  beds: z.coerce.number().int().min(1).optional().default(1),
  baths: z.coerce.number().min(1).optional().default(1),
  sqft: z.coerce.number().int().min(1).optional().default(35),
  basePrice: z.coerce.number().min(50000, 'Minimum price is 50,000'),
  imageUrls: z.array(z.string()).min(1, 'At least one image is required'),
  amenities: z.array(z.string()).optional().default([]),
  cleaningFee: z.coerce.number().min(0).optional().default(0),
  serviceFee: z.coerce.number().min(0).optional().default(0),
  securityDeposit: z.coerce.number().min(0).optional().default(0),
  guests: z.coerce.number().int().min(1).optional().default(1),
  status: z.enum(['ACTIVE', 'INACTIVE', 'PUBLISHED', 'DRAFT', 'ARCHIVED']).optional().default('ACTIVE'),
  rooms: z.array(z.any()).optional()
});

export const CalendarBulkUpdateSchema = z.object({
  roomId: z.string().min(1, 'Room ID is required'),
  dates: z.array(z.string()).min(1, 'At least one date is required'),
  isBlocked: z.boolean(),
  priceOverride: z.number().positive().optional()
});

