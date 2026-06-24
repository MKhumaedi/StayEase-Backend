import dotenv from 'dotenv';
import path from 'path';

// Try loading env from root or backend
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), 'backend', '.env') });

// Inline sanitization of environment variables
function sanitizeEnv(key: string) {
  let val = process.env[key];
  if (!val) return;
  let cleaned = val.trim();
  const prefixRegex = new RegExp(`^${key}\\s*=`, 'i');
  if (prefixRegex.test(cleaned)) {
    cleaned = cleaned.replace(prefixRegex, '').trim();
  }
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  } else if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  }
  process.env[key] = cleaned;
}

sanitizeEnv('DATABASE_URL');
sanitizeEnv('DIRECT_URL');

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  console.log('Pre-migrate: converting ADMIN/HOST users to TENANT inside Supabase...');
  try {
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "User" SET role = 'TENANT' WHERE role = 'ADMIN' OR role = 'HOST';`
    );
    console.log(`Successfully updated ${updated} users to TENANT.`);
  } catch (err) {
    console.error('Pre-migrate: error or tables do not exist yet:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();

