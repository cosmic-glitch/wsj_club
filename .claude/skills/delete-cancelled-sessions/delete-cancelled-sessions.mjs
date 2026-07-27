// Delete every CANCELLED voice-quiz session — the rc_quiz_sessions row in
// Supabase (what production reads) AND its Blob record (JSON + audio).
//
// A "cancelled" session is one saved with `cancelled: true` — the student pressed
// Cancel, so it ended early and was never graded (score "—"). These are safe
// cleanup targets, but deletion is IRREVERSIBLE.
//
// Run from the repo root (so Node can resolve @vercel/blob) and pass the env
// via --env-file:
//
//   node --env-file=.env.local .claude/skills/delete-cancelled-sessions/delete-cancelled-sessions.mjs         # dry run: list only, delete nothing
//   node --env-file=.env.local .claude/skills/delete-cancelled-sessions/delete-cancelled-sessions.mjs --yes   # actually delete
//
// Mirrors the delete path in app/api/quiz-session/route.ts: Blob first
// (source_blob pathname + audio URL), then the DB row — a blob failure leaves
// both stores intact for that session.

import { del } from "@vercel/blob";

const CONFIRM =
  process.argv.includes("--yes") || process.argv.includes("--confirm");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, BLOB_READ_WRITE_TOKEN } =
  process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !BLOB_READ_WRITE_TOKEN) {
  console.error(
    "SUPABASE_URL, SUPABASE_SERVICE_KEY and BLOB_READ_WRITE_TOKEN must be set.\n" +
      "Run from the repo root with: node --env-file=.env.local " +
      ".claude/skills/delete-cancelled-sessions/delete-cancelled-sessions.mjs [--yes]"
  );
  process.exit(1);
}

const base = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/`;
const headers = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
};

const res = await fetch(
  base +
    "rc_quiz_sessions?cancelled=eq.true" +
    "&select=id,date,track,student_name,login_user,ended_at,source_blob,audio_url" +
    "&order=ended_at.asc",
  { headers, cache: "no-store" }
);
if (!res.ok) {
  console.error(`DB select failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const cancelled = await res.json();

if (cancelled.length === 0) {
  console.log("No cancelled sessions found. Nothing to delete.");
  process.exit(0);
}

console.log(`Found ${cancelled.length} cancelled session(s):\n`);
for (const c of cancelled) {
  console.log(
    `  ${c.date}  ${c.track === "junior" ? "junior" : "senior"}  ` +
      `${String(c.login_user ?? c.student_name ?? "?").padEnd(10)}  ${c.ended_at}  ` +
      (c.audio_url ? "(+audio)" : "(no audio)")
  );
}

if (!CONFIRM) {
  console.log(
    `\nDRY RUN — nothing deleted. ${cancelled.length} DB row(s) plus their ` +
      "blobs would be removed.\nRe-run with --yes to delete them."
  );
  process.exit(0);
}

console.log("");
let ok = 0;
for (const c of cancelled) {
  // The session JSON by pathname (source_blob), the audio by URL (query
  // params stripped). del() succeeds on already-missing blobs.
  const targets = [
    typeof c.source_blob === "string" && c.source_blob ? c.source_blob : null,
    typeof c.audio_url === "string" && c.audio_url
      ? c.audio_url.split("?")[0]
      : null,
  ].filter(Boolean);
  try {
    if (targets.length) await del(targets);
  } catch (err) {
    console.error(`  ${c.id}: blob delete failed, row kept —`, err.message);
    continue;
  }
  const dres = await fetch(
    base + `rc_quiz_sessions?id=eq.${encodeURIComponent(c.id)}`,
    { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } }
  );
  if (!dres.ok) {
    console.error(`  ${c.id}: DB delete failed: ${dres.status}`);
    continue;
  }
  ok++;
}

console.log(`Done. Deleted ${ok} of ${cancelled.length} cancelled session(s).`);
