import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let _client: SupabaseClient | null = null;
try {
  if (url && key) {
    _client = createClient(url, key);
  }
} catch (e) {
  console.error('[Supabase] URL o key inválida — app funcionará solo offline:', e);
}

export const supabase = _client;
export const supabaseConfigurado = !!_client;