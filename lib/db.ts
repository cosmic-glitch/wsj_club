import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The Supabase project is SHARED with whisper-anywhere — all Reading Club
// tables are rc_-prefixed. Server-side only: the service key bypasses RLS
// and must never reach the browser.
let client: SupabaseClient | null | undefined;

/**
 * The shared server-side Supabase client, or null when SUPABASE_URL /
 * SUPABASE_SERVICE_KEY are not configured (e.g. a fresh checkout). During the
 * dual-write shadow phase (PLAN-supabase.md) callers treat null as "skip the
 * DB write" — Blob remains the store of record.
 */
export function getDb(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  try {
    client =
      url && key
        ? createClient(url, key, { auth: { persistSession: false } })
        : null;
  } catch (err) {
    // supabase-js needs Node 22+ (native WebSocket) even though we never use
    // realtime — on an older local Node the shadow writes just skip.
    console.error("Supabase client unavailable:", err);
    client = null;
  }
  return client;
}
