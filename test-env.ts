import dotenv from 'dotenv';
import path from 'path';

// Try loading env from root or backend
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), 'backend', '.env') });

console.log('Environment keys:', Object.keys(process.env).filter(k=> k.includes('URL') || k.includes('KEY') || k.includes('DB') || k.includes('PRISMA') || k.includes('SECRET') || k.includes('DATABASE')));
console.log('DATABASE_URL length:', process.env.DATABASE_URL?.length || 0);
