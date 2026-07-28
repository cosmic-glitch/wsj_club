/**
 * Shared PostgREST helpers for the Node scripts (open-vote, check-vote,
 * add-user). Plain fetch against the Supabase REST API with the service key —
 * same approach as lib/db.ts, but LOUD: scripts want failures thrown, not
 * swallowed.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_KEY (run with --env-file=.env.local).
 * The project is shared with whisper-anywhere — only ever touch rc_* tables.
 */

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set (use --env-file=.env.local)");
  }
  return {
    base: `${url.replace(/\/+$/, "")}/rest/v1/`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

/** SELECT: query is a raw PostgREST query string starting with "?". */
export async function dbSelect(table, query = "?select=*") {
  const { base, headers } = config();
  const res = await fetch(`${base}${table}${query}`, { headers });
  if (!res.ok) throw new Error(`select ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Upsert one row or an array (INSERT … ON CONFLICT DO UPDATE). */
export async function dbUpsert(table, rows, onConflict) {
  const { base, headers } = config();
  const res = await fetch(`${base}${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!res.ok) throw new Error(`upsert ${table}: ${res.status} ${await res.text()}`);
}

/** PATCH the rows matching the filter query (refuses an empty filter). */
export async function dbUpdate(table, query, patch) {
  if (!query?.startsWith("?") || query.length < 2) {
    throw new Error(`update ${table}: empty filter refused`);
  }
  const { base, headers } = config();
  const res = await fetch(`${base}${table}${query}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update ${table}: ${res.status} ${await res.text()}`);
}

/** DELETE rows matching the filter query (refuses an empty filter). */
export async function dbDelete(table, query) {
  if (!query?.startsWith("?") || query.length < 2) {
    throw new Error(`delete ${table}: empty filter refused`);
  }
  const { base, headers } = config();
  const res = await fetch(`${base}${table}${query}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=minimal" },
  });
  if (!res.ok) throw new Error(`delete ${table}: ${res.status} ${await res.text()}`);
}
