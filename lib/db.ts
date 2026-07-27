/**
 * Minimal PostgREST client for the Supabase project (PLAN-supabase.md).
 *
 * The project is SHARED with whisper-anywhere — all Reading Club tables are
 * rc_-prefixed. Server-side only: the service key bypasses RLS and must never
 * reach the browser.
 *
 * Deliberately plain fetch, not @supabase/supabase-js: the SDK (v2.110+)
 * constructs a realtime client that requires Node 22's native WebSocket even
 * when realtime is never used — a silent landmine for local scripts (this
 * machine runs Node 21) and for any future runtime drift. The three verbs we
 * need are plain HTTP against PostgREST.
 *
 * The rc_* tables are the ONLY store for users, quiz sessions, slots, and
 * votes (the Blob migration finished at Phase 4 — PLAN-supabase.md). Every
 * call logs and returns null/false on failure rather than throwing; callers
 * are responsible for surfacing that as an error (a failed write is a failed
 * request now, not tolerable drift).
 */

type DbConfig = { base: string; headers: Record<string, string> };

function config(): DbConfig | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url.replace(/\/+$/, "")}/rest/v1/`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

/** True when SUPABASE_URL + SUPABASE_SERVICE_KEY are set. */
export function dbConfigured(): boolean {
  return config() !== null;
}

/**
 * SELECT. `query` is a raw PostgREST query string starting with "?"
 * (e.g. `?username=eq.${encodeURIComponent(name)}&select=*`).
 * Returns the rows, or null on any failure (logged) — including unconfigured.
 */
export async function dbSelect(
  table: string,
  query: string
): Promise<Record<string, unknown>[] | null> {
  const cfg = config();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.base}${table}${query}`, {
      headers: cfg.headers,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return (await res.json()) as Record<string, unknown>[];
  } catch (err) {
    console.error(`DB select ${table} failed:`, err);
    return null;
  }
}

/**
 * Plain INSERT (no conflict resolution) — for creates where a duplicate key
 * must be an error, never a silent overwrite (e.g. a new username). Returns
 * "conflict" on a unique-key violation so callers can map it to a friendly
 * error.
 */
export async function dbInsert(
  table: string,
  row: Record<string, unknown>
): Promise<"ok" | "conflict" | "error"> {
  const cfg = config();
  if (!cfg) return "error";
  try {
    const res = await fetch(`${cfg.base}${table}`, {
      method: "POST",
      headers: { ...cfg.headers, Prefer: "return=minimal" },
      body: JSON.stringify([row]),
    });
    if (res.status === 409) return "conflict";
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return "ok";
  } catch (err) {
    console.error(`DB insert ${table} failed:`, err);
    return "error";
  }
}

/**
 * INSERT … ON CONFLICT (onConflict) DO UPDATE — the atomic upsert.
 * Accepts one row or an array. Returns success.
 */
export async function dbUpsert(
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
  onConflict: string
): Promise<boolean> {
  const cfg = config();
  if (!cfg) return false;
  try {
    const res = await fetch(
      `${cfg.base}${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      {
        method: "POST",
        headers: {
          ...cfg.headers,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
      }
    );
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return true;
  } catch (err) {
    console.error(`DB upsert ${table} failed:`, err);
    return false;
  }
}

/**
 * DELETE the rows matching the filter query (same raw "?" form as dbSelect).
 * Refuses an empty filter — a missing query must never become "delete all".
 * Returns success (deleting zero rows is success — deletes are idempotent).
 */
export async function dbDelete(table: string, query: string): Promise<boolean> {
  const cfg = config();
  if (!cfg) return false;
  if (!query.startsWith("?") || query.length < 2) {
    console.error(`DB delete ${table} refused: empty filter`);
    return false;
  }
  try {
    const res = await fetch(`${cfg.base}${table}${query}`, {
      method: "DELETE",
      headers: { ...cfg.headers, Prefer: "return=minimal" },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return true;
  } catch (err) {
    console.error(`DB delete ${table} failed:`, err);
    return false;
  }
}
