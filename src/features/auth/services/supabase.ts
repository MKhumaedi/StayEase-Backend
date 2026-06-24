import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Cache clients to prevent recreating them on every call
let supabaseClientInstance: SupabaseClient | null = null;
let supabaseAdminInstance: SupabaseClient | null = null;

export function getProjectRef(): string | null {
  const dbUrl = process.env.DATABASE_URL || '';
  const match = dbUrl.match(/postgres(?:ql)?\.([^:@\/]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return null;
}

export function getSupabaseUrl(): string {
  if (process.env.SUPABASE_URL) {
    let url = process.env.SUPABASE_URL.trim();
    // Normalize url if it contains the REST suffix or trailing slash
    url = url.replace(/\/rest\/v1\/?$/, '');
    url = url.replace(/\/$/, '');
    return url;
  }
  const ref = getProjectRef();
  if (ref) {
    return `https://${ref}.supabase.co`;
  }
  // Fallback default
  return '';
}

export function getSupabaseClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();

  if (!url) {
    throw new Error('Supabase URL cannot be resolved. Please configure DATABASE_URL or SUPABASE_URL.');
  }
  if (!anonKey) {
    throw new Error('SUPABASE_ANON_KEY is not configured in .env / secrets.');
  }

  if (!supabaseClientInstance) {
    supabaseClientInstance = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  return supabaseClientInstance;
}

export function getSupabaseAdmin(): SupabaseClient {
  const url = getSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url) {
    throw new Error('Supabase URL cannot be resolved. Please configure DATABASE_URL or SUPABASE_URL.');
  }
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured in .env / secrets.');
  }

  if (!supabaseAdminInstance) {
    supabaseAdminInstance = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  return supabaseAdminInstance;
}
