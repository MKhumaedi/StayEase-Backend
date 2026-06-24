import dotenv from 'dotenv';
import path from 'path';
import { spawn } from 'child_process';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), 'backend', '.env') });

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

const args = process.argv.slice(2);
console.log('Running prisma with args:', args);

const child = spawn('npx', ['prisma', ...args], {
  env: process.env,
  stdio: 'inherit',
  shell: true
});

child.on('close', (code) => {
  process.exit(code || 0);
});
