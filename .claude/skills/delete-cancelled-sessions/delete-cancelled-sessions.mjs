// Delete every CANCELLED voice-quiz session from Vercel Blob (its JSON + its audio).
//
// A "cancelled" session is one saved with `cancelled: true` — the student pressed
// Cancel, so it ended early and was never graded (score "—"). These are safe
// cleanup targets, but deletion is IRREVERSIBLE (the JSON and the stitched audio
// recording are removed from Blob).
//
// Run from the repo root (so Node can resolve @vercel/blob) and pass the Blob
// token via --env-file:
//
//   node --env-file=.env.local .claude/skills/delete-cancelled-sessions/delete-cancelled-sessions.mjs         # dry run: list only, delete nothing
//   node --env-file=.env.local .claude/skills/delete-cancelled-sessions/delete-cancelled-sessions.mjs --yes   # actually delete
//
// Mirrors the delete path in app/api/quiz-session/route.ts: it removes the
// session JSON plus its `audioUrl` recording, both under the quiz-sessions/ prefix.

import { list, del } from "@vercel/blob";

const CONFIRM =
  process.argv.includes("--yes") || process.argv.includes("--confirm");

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error(
    "BLOB_READ_WRITE_TOKEN is not set.\n" +
      "Run from the repo root with: node --env-file=.env.local " +
      ".claude/skills/delete-cancelled-sessions/delete-cancelled-sessions.mjs [--yes]"
  );
  process.exit(1);
}

const { blobs } = await list({ prefix: "quiz-sessions/" });

// Fetch + parse every session JSON, keep only the cancelled ones. Skip the audio
// recordings (never JSON.parse a .webm/.mp4/.wav) and guard each parse so one bad
// blob can't abort the run. Key the URL by uploadedAt to dodge the Blob CDN edge
// cache (same trap lib/sessions.ts documents).
const cancelled = (
  await Promise.all(
    blobs
      .filter((b) => b.pathname.endsWith(".json"))
      .map(async (b) => {
        try {
          const v = new Date(b.uploadedAt).getTime();
          const res = await fetch(`${b.url}?v=${v}`, { cache: "no-store" });
          const s = await res.json();
          if (!s.cancelled) return null;
          return {
            date: s.date,
            student: s.loginUser ?? s.studentName ?? "?",
            endedAt: s.endedAt ?? s.updatedAt ?? "",
            jsonUrl: b.url,
            audioUrl: s.audioUrl,
          };
        } catch (err) {
          console.error("Skipping unreadable blob:", b.pathname, err.message);
          return null;
        }
      })
  )
).filter(Boolean);

cancelled.sort((a, b) => a.endedAt.localeCompare(b.endedAt));

if (cancelled.length === 0) {
  console.log("No cancelled sessions found. Nothing to delete.");
  process.exit(0);
}

console.log(`Found ${cancelled.length} cancelled session(s):\n`);
for (const c of cancelled) {
  console.log(
    `  ${c.date}  ${String(c.student).padEnd(10)}  ${c.endedAt}  ` +
      (c.audioUrl ? "(+audio)" : "(no audio)")
  );
}

// Every blob to remove: each session's JSON + its audio recording (when present).
const urls = cancelled.flatMap((c) => [c.jsonUrl, c.audioUrl].filter(Boolean));

if (!CONFIRM) {
  console.log(
    `\nDRY RUN — nothing deleted. ${urls.length} blob(s) would be removed.\n` +
      "Re-run with --yes to delete them."
  );
  process.exit(0);
}

console.log(`\nDeleting ${urls.length} blob(s)...`);
await del(urls);
console.log(
  `Done. Deleted ${cancelled.length} cancelled session(s) (${urls.length} blob(s)).`
);
