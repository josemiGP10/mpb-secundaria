import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Configuración directa — la anon key es pública por diseño (protección via RLS)
const SUPABASE_URL = 'https://ollickvqbbkemgvcnhio.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sbGlja3ZxYmJrZW1ndmNuaGlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NTE2NzcsImV4cCI6MjA5OTUyNzY3N30.5NW1nAgDN72B2YG5p2aGg5msU4CaLsqZIWdaMTnIoOM';

let _client: SupabaseClient | null = null;
try {
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error('[Supabase] Error inicializando cliente:', e);
}

export const supabase = _client;
export const supabaseConfigurado = !!_client;