// Generate US-English pronunciation audio (OpenAI TTS, `alloy`) for a day's
// vocabulary words and concept names, saved as static clips the handout plays
// via the ▶ button:  public/audio/<date>/<slug>.mp3  (committed + CDN-served,
// like public/pdfs). The clip speaks the real word — not a respelling — so the
// handout shows no phonetic text.
//
// Usage:
//   node --env-file=.env.local scripts/gen-pronunciation.mjs 2026-07-14   # one day
//   node --env-file=.env.local scripts/gen-pronunciation.mjs all          # every day
//   node --env-file=.env.local scripts/gen-pronunciation.mjs all --force  # regenerate all
//
// Idempotent: existing clips are skipped unless --force. The filename slug MUST
// match slugify() in app/reading/[date]/page.tsx, or the handout won't find them.
// Voice/model are env-overridable (PRONOUNCE_VOICE / PRONOUNCE_MODEL).

import fs from "node:fs";
import path from "node:path";

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error("OPENAI_API_KEY missing — run with --env-file=.env.local");
  process.exit(1);
}

const MODEL = process.env.PRONOUNCE_MODEL || "gpt-4o-mini-tts";
const VOICE = process.env.PRONOUNCE_VOICE || "alloy";
const CONTENT = path.join(process.cwd(), "content");
const AUDIO = path.join(process.cwd(), "public", "audio");

const args = process.argv.slice(2);
const force = args.includes("--force");
const target = args.find((a) => !a.startsWith("--")) || "all";

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const INSTRUCTIONS =
  "Say the following word or phrase clearly and naturally in standard " +
  "American English, at a calm, unhurried pace with the correct stress. " +
  "Say it once; do not spell it out.";

function daysToProcess() {
  const all = fs
    .readdirSync(CONTENT)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  if (target === "all") return all;
  if (!all.includes(target)) {
    console.error(`No content file for ${target}`);
    process.exit(1);
  }
  return [target];
}

async function tts(text) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      voice: VOICE,
      input: text,
      response_format: "mp3",
      instructions: INSTRUCTIONS,
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

let made = 0;
let skipped = 0;
let failed = 0;

for (const date of daysToProcess()) {
  const reading = JSON.parse(fs.readFileSync(path.join(CONTENT, `${date}.json`), "utf8"));
  const terms = [
    ...(reading.vocab || []).map((w) => w.word),
    ...(reading.concepts || []).map((c) => c.name),
  ].filter(Boolean);
  const outDir = path.join(AUDIO, date);
  fs.mkdirSync(outDir, { recursive: true });

  await mapLimit(terms, 6, async (term) => {
    const file = path.join(outDir, `${slug(term)}.mp3`);
    if (!force && fs.existsSync(file)) {
      skipped++;
      return;
    }
    try {
      const buf = await tts(term);
      fs.writeFileSync(file, buf);
      made++;
      console.log(`ok   ${date}/${slug(term)}.mp3  (${(buf.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${date}/${slug(term)}.mp3  <- "${term}"  ${e.message}`);
    }
  });
}

console.log(`\nDone. made=${made} skipped=${skipped} failed=${failed}  voice=${VOICE} model=${MODEL}`);
if (failed) process.exit(1);
