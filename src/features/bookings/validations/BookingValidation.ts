import { z } from 'zod';

export const CreateBookingSchema = z.object({
  guestId: z.string().min(1, 'Guest ID is required'),
  guestName: z.string().min(1, 'Guest name is required'),
  guestEmail: z.string().email('Please enter a valid email address'),
  guestPhone: z.string().min(5, 'Please enter a valid phone number'),
  propertyId: z.string().min(1, 'Property ID is required'),
  roomId: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD')
});

export const UploadPaymentProofSchema = z.object({
  proofUrl: z.string().url('Please enter a valid proof image/document URL')
});

export const BookingSearchSchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).optional().default(10),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  propertyId: z.string().optional(),
  guestId: z.string().optional(),
  tenantId: z.string().optional(),
  checkoutRequested: z.union([z.string(), z.boolean()]).optional(),
  checkedOutAtNull: z.union([z.string(), z.boolean()]).optional()
});

export type BookingSearchInput = z.infer<typeof BookingSearchSchema>;

