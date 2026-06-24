import { z } from 'zod';

export const RegisterSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, { message: 'Name must be at least 2 characters long' }),
  email: z.string().email({ message: 'Please enter a valid email address' }),
  role: z.enum(['USER', 'TENANT']).optional().default('TENANT'),
  password: z.string().optional().default('StayEase2026!')
    .refine(val => {
      if (val === 'StayEase2026!') return true;
      return val.length >= 8 && /[A-Z]/.test(val) && /[a-z]/.test(val) && /[0-9]/.test(val);
    }, { message: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number' })
});

export const LoginSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address' }),
  password: z.string().optional().default('StayEase2026!')
});

export const VerifySchema = z.object({
  token: z.string().min(1, { message: 'Token is required' })
});

export const ResetPasswordRequestSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address' })
});

export const ResetPasswordSubmitSchema = z.object({
  token: z.string().min(1, { message: 'Token is required' }),
  password: z.string()
    .min(8, { message: 'Password must be at least 8 characters long' })
    .regex(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
    .regex(/[a-z]/, { message: 'Password must contain at least one lowercase letter' })
    .regex(/[0-9]/, { message: 'Password must contain at least one number' })
});
