import { z } from 'zod';

export const CreateTransactionSchema = z.object({
  bookingId: z.string().uuid('Invalid booking UUID').or(z.string().min(1, 'Booking key code is required'))
});

export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
