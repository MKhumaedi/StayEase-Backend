import { PrismaClient } from '@prisma/client';

// Inline sanitization of environment variables to prevent platform encoding/quotes issues
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

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = globalThis.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

