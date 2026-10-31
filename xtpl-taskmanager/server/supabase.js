import { createClient } from '@supabase/supabase-js';

const url = String(process.env.SUPABASE_URL || '').trim();
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export const supabaseEnabled = Boolean(url && serviceKey);
export const supabase = supabaseEnabled
  ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

export function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}
